/**
 * Unison feed sentinel (Chainlink CRE), for the causal mainnet (SPEC §7.4).
 *
 * Unison's mainnet auctions price at Chainlink's first observation after their orders are sealed. The sentinel is the
 * independent check on that feed. Every run, for each market:
 *   1. read ChainlinkCausalReference.latest on Monad: the price, and the time Chainlink's quorum signed for it;
 *   2. have every DON node price the asset from public exchanges (the median across sources), then agree across
 *      nodes (median);
 *   3. halt the market only if the feed and the exchanges differ by more than `maxDeviationBps` AND the feed has been
 *      silent for more than `maxSilentSec`. A gap alone isn't enough: during a fast move the feed trails the
 *      exchanges for the ~13 s an observation is in flight, and that is the rule working, not a broken feed.
 * A halt is a report to CREAuditReceiver (KIND_HALT), which calls setHalt on the exchange: the next auction trades
 * nothing and returns every waiting order unfilled. Lifting a halt stays with the guardian.
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
import { CAUSAL_REFERENCE_ABI } from "../../src/abi.ts";
import { encodeHalt, median, pick, sentinelDecision, toQuoteUnits } from "../../src/logic.ts";

const sourceSchema = z.object({
  name: z.string(),
  url: z.string(),
  path: z.string(), // JSON path to the price, e.g. "result.MONUSD.c.0"
  headers: z.record(z.string()).optional(),
});

const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
  causalReference: z.string(),
  receiver: z.string(),
  gasLimit: z.string(),
  quoteDecimals: z.number(),
  maxDeviationBps: z.number(),
  maxSilentSec: z.number(),
  markets: z.array(z.object({ marketId: z.number(), symbol: z.string(), sources: z.array(sourceSchema) })),
});
type Config = z.infer<typeof configSchema>;
type Source = z.infer<typeof sourceSchema>;

/** Node mode: this node asks every source and keeps the median of the ones that answered. */
const priceFromSources = (req: HTTPSendRequester, sources: Source[]): number => {
  const prices: number[] = [];
  for (const s of sources) {
    try {
      const resp = req.sendRequest({ url: s.url, method: "GET", headers: s.headers ?? {} }).result();
      if (!ok(resp)) continue;
      const v = Number(pick(JSON.parse(text(resp)), s.path));
      if (Number.isFinite(v) && v > 0) prices.push(v);
    } catch {
      // one exchange being down must not stop the check
    }
  }
  if (prices.length === 0) throw new Error("no exchange answered");
  return median(prices);
};

const onCron = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName, isTestnet: cfg.isTestnet });
  if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`);
  const evm = new EVMClient(network.chainSelector.selector);
  const http = new HTTPClient();
  const now = BigInt(Math.floor(runtime.now().getTime() / 1000));
  const results: string[] = [];

  for (const m of cfg.markets) {
    const call = evm
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: cfg.causalReference as Address,
          data: encodeFunctionData({ abi: CAUSAL_REFERENCE_ABI, functionName: "latest", args: [BigInt(m.marketId)] }),
        }),
      })
      .result();
    const [feedPrice, observedAt, , round] = decodeFunctionResult({
      abi: CAUSAL_REFERENCE_ABI,
      functionName: "latest",
      data: bytesToHex(call.data),
    });

    const consensus = http.sendRequest(runtime, priceFromSources, consensusMedianAggregation())(m.sources).result();
    const market = toQuoteUnits(consensus, cfg.quoteDecimals);
    const d = sentinelDecision({
      feedPrice,
      observedAt,
      now,
      consensus: market,
      maxDeviationBps: cfg.maxDeviationBps,
      maxSilentSec: cfg.maxSilentSec,
    });
    runtime.log(
      `${m.symbol}: Chainlink round ${round} at ${feedPrice} (observed ${d.silentSec} s ago) vs exchanges ${market} → ${d.dev} bp`,
    );
    if (!d.halt) {
      results.push(`${m.symbol}:ok:${d.dev}bp:${d.silentSec}s`);
      continue;
    }
    const report = runtime
      .report(prepareReportRequest(encodeHalt(BigInt(m.marketId), true, `feed ${d.dev}bp off, ${d.silentSec}s silent`)))
      .result();
    const resp = evm.writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } }).result();
    if (resp.txStatus !== TxStatus.SUCCESS) throw new Error(`halt report failed: ${resp.errorMessage ?? resp.txStatus}`);
    results.push(`${m.symbol}:HALT:${d.dev}bp:${d.silentSec}s`);
  }
  return results.join(",");
};

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
