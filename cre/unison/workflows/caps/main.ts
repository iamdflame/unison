/**
 * Unison daily volume caps (Chainlink CRE).
 * Once a day, before the US open: every DON node computes each symbol's average daily volume over the configured
 * window from a market-data API; nodes agree on the median; the workflow writes the caps (ADV × tier bps:
 * 0.25% tier 1, 2.5% tier 2 — SEC Release 34-106402) to CREAuditReceiver → UnisonExchange.setDailyCap.
 */
import {
  consensusMedianAggregation,
  CronCapability,
  EVMClient,
  getNetwork,
  handler,
  HTTPClient,
  type HTTPSendRequester,
  ok,
  prepareReportRequest,
  Runner,
  type Runtime,
  text,
  TxStatus,
} from "@chainlink/cre-sdk";
import { z } from "zod";
import { capFromAdv, encodeCaps, pick } from "../../src/logic.ts";

const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
  receiver: z.string(),
  gasLimit: z.string(),
  barsUrl: z.string(), // returns daily bars for "{SYMBOL}", e.g. Alpaca /v2/stocks/{SYMBOL}/bars?timeframe=1Day&limit=20
  barsPath: z.string(), // JSON path to the bar array, e.g. "bars"
  volumeField: z.string(), // field holding the share volume, e.g. "v"
  apiKeySecret: z.string().optional(),
  apiKeyHeader: z.string().optional(),
  markets: z.array(
    z.object({ marketId: z.number(), symbol: z.string(), tier: z.union([z.literal(1), z.literal(2)]), baseDecimals: z.number() }),
  ),
});
type Config = z.infer<typeof configSchema>;

const averageVolume = (
  req: HTTPSendRequester,
  input: { url: string; path: string; field: string; headers: Record<string, string> },
): number => {
  const resp = req.sendRequest({ url: input.url, method: "GET", headers: input.headers }).result();
  if (!ok(resp)) throw new Error(`bars: HTTP ${resp.statusCode}`);
  const bars = pick(JSON.parse(text(resp)), input.path);
  if (!Array.isArray(bars) || bars.length === 0) throw new Error("no bars");
  const vols = bars.map((b) => Number((b as Record<string, unknown>)[input.field])).filter((v) => Number.isFinite(v));
  return vols.reduce((a, b) => a + b, 0) / vols.length;
};

const onCron = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName, isTestnet: cfg.isTestnet });
  if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`);
  const headers: Record<string, string> = {};
  if (cfg.apiKeySecret && cfg.apiKeyHeader) {
    headers[cfg.apiKeyHeader] = runtime.getSecret({ id: cfg.apiKeySecret }).result().value;
  }
  const http = new HTTPClient();
  const ids: bigint[] = [];
  const caps: bigint[] = [];
  for (const m of cfg.markets) {
    const adv = http
      .sendRequest(runtime, averageVolume, consensusMedianAggregation())({
        url: cfg.barsUrl.replace("{SYMBOL}", m.symbol),
        path: cfg.barsPath,
        field: cfg.volumeField,
        headers,
      })
      .result();
    ids.push(BigInt(m.marketId));
    caps.push(capFromAdv(adv, m.tier, m.baseDecimals));
    runtime.log(`${m.symbol}: ADV ${Math.round(adv)} shares → tier ${m.tier} cap ${caps.at(-1)}`);
  }
  const report = runtime.report(prepareReportRequest(encodeCaps(ids, caps))).result();
  const resp = new EVMClient(network.chainSelector.selector)
    .writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } })
    .result();
  if (resp.txStatus !== TxStatus.SUCCESS) throw new Error(`caps report failed: ${resp.errorMessage ?? resp.txStatus}`);
  return `caps:${ids.length}`;
};

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
