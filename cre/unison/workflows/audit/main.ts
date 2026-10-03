/**
 * Unison reference audit (Chainlink CRE).
 * Every run, for each market: read the operator-signed reference the venue is using (OperatorSignedReference.last),
 * have every DON node price the asset from independent sources (median across sources), reach consensus across
 * nodes (median), and — only if the operator's price deviates beyond `maxDeviationBps` — write a signed report to
 * CREAuditReceiver, which halts the market and slashes the signer's bond.
 */
import {
  bytesToHex,
  consensusMedianAggregation,
  CronCapability,
  EVMClient,
  encodeCallMsg,
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
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from "viem";
import { z } from "zod";
import { OPERATOR_REFERENCE_ABI } from "../../src/abi.ts";
import { deviationBps, encodeAudit, median, pick, toQuoteUnits } from "../../src/logic.ts";

const sourceSchema = z.object({
  name: z.string(),
  url: z.string(), // "{SYMBOL}" is substituted
  path: z.string(), // JSON path to the price, e.g. "trade.p"
  headers: z.record(z.string()).optional(), // values may reference secrets as "{SECRET:NAME}"
});

const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
  operatorReference: z.string(),
  receiver: z.string(),
  gasLimit: z.string(),
  quoteDecimals: z.number(),
  maxDeviationBps: z.number(),
  markets: z.array(z.object({ marketId: z.number(), symbol: z.string(), signerId: z.number() })),
  sources: z.array(sourceSchema),
});
type Config = z.infer<typeof configSchema>;
type Source = z.infer<typeof sourceSchema>;

/** Node mode: this node asks every source and keeps the median of the ones that answered. */
const priceFromSources = (req: HTTPSendRequester, input: { symbol: string; sources: Source[] }): number => {
  const prices: number[] = [];
  for (const s of input.sources) {
    try {
      const resp = req
        .sendRequest({ url: s.url.replace("{SYMBOL}", input.symbol), method: "GET", headers: s.headers ?? {} })
        .result();
      if (!ok(resp)) continue;
      const v = Number(pick(JSON.parse(text(resp)), s.path));
      if (Number.isFinite(v) && v > 0) prices.push(v);
    } catch {
      // a source being down must not stop the audit
    }
  }
  if (prices.length === 0) throw new Error(`no source priced ${input.symbol}`);
  return median(prices);
};

const resolveSecrets = (runtime: Runtime<Config>, sources: Source[]): Source[] =>
  sources.map((s) => ({
    ...s,
    headers: Object.fromEntries(
      Object.entries(s.headers ?? {}).map(([k, v]) => {
        const m = v.match(/^\{SECRET:([A-Z0-9_]+)\}$/);
        return [k, m ? runtime.getSecret({ id: m[1]! }).result().value : v];
      }),
    ),
  }));

const onCron = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName, isTestnet: cfg.isTestnet });
  if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`);
  const evm = new EVMClient(network.chainSelector.selector);
  const http = new HTTPClient();
  const sources = resolveSecrets(runtime, cfg.sources);
  const results: string[] = [];

  for (const m of cfg.markets) {
    const call = evm
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: cfg.operatorReference as Address,
          data: encodeFunctionData({ abi: OPERATOR_REFERENCE_ABI, functionName: "last", args: [BigInt(m.marketId)] }),
        }),
      })
      .result();
    const [opPrice, opMs] = decodeFunctionResult({
      abi: OPERATOR_REFERENCE_ABI,
      functionName: "last",
      data: bytesToHex(call.data),
    });
    if (opMs === 0n) continue; // no reference consumed yet

    const consensus = http
      .sendRequest(runtime, priceFromSources, consensusMedianAggregation())({ symbol: m.symbol, sources })
      .result();
    const audited = toQuoteUnits(consensus, cfg.quoteDecimals);
    const dev = deviationBps(opPrice, audited);
    runtime.log(`${m.symbol}: operator ${opPrice} vs consensus ${audited} → ${dev} bp`);
    if (dev <= BigInt(cfg.maxDeviationBps)) {
      results.push(`${m.symbol}:ok:${dev}`);
      continue;
    }
    const report = runtime.report(prepareReportRequest(encodeAudit(BigInt(m.marketId), audited, opMs, m.signerId))).result();
    const resp = evm
      .writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } })
      .result();
    if (resp.txStatus !== TxStatus.SUCCESS) throw new Error(`audit report failed: ${resp.errorMessage ?? resp.txStatus}`);
    results.push(`${m.symbol}:HALT:${dev}`);
  }
  return results.join(",");
};

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
