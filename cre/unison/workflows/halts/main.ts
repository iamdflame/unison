/**
 * Unison halt mirroring (Chainlink CRE).
 * Every minute: read Nasdaq's trade-halts feed, decide per listed symbol whether the primary market is halted,
 * compare with the venue's on-chain halt flag and write only the changes (halt / resume) to CREAuditReceiver.
 * Nodes agree on a bitmask of active halts (identical inputs → identical median).
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
import { EXCHANGE_ABI } from "../../src/abi.ts";
import { encodeHalt, haltDecisions, parseNasdaqHalts, type HaltRecord } from "../../src/logic.ts";

const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
  exchange: z.string(),
  receiver: z.string(),
  gasLimit: z.string(),
  haltsUrl: z.string(), // https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts
  markets: z.array(z.object({ marketId: z.number(), symbol: z.string() })),
});
type Config = z.infer<typeof configSchema>;

/** Node mode: bit i set ⇔ markets[i]'s primary market has an active halt. */
const activeHaltMask = (req: HTTPSendRequester, input: { url: string; symbols: string[] }): number => {
  const resp = req.sendRequest({ url: input.url, method: "GET" }).result();
  if (!ok(resp)) throw new Error(`halts feed: HTTP ${resp.statusCode}`);
  const halts = parseNasdaqHalts(text(resp));
  return input.symbols.reduce((mask, s, i) => (halts.get(s)?.active ? mask | (1 << i) : mask), 0);
};

const onCron = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName, isTestnet: cfg.isTestnet });
  if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`);
  const evm = new EVMClient(network.chainSelector.selector);
  const mask = new HTTPClient()
    .sendRequest(runtime, activeHaltMask, consensusMedianAggregation())({
      url: cfg.haltsUrl,
      symbols: cfg.markets.map((m) => m.symbol),
    })
    .result();

  const halts = new Map<string, HaltRecord>();
  cfg.markets.forEach((m, i) => halts.set(m.symbol, { symbol: m.symbol, reason: "HALT", active: ((mask >> i) & 1) === 1 }));
  const onchain = new Map<number, boolean>();
  for (const m of cfg.markets) {
    const call = evm
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: cfg.exchange as Address,
          data: encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "regimeOf", args: [BigInt(m.marketId)] }),
        }),
      })
      .result();
    const r = decodeFunctionResult({ abi: EXCHANGE_ABI, functionName: "regimeOf", data: bytesToHex(call.data) });
    onchain.set(m.marketId, r.halted);
  }
  for (const m of cfg.markets) {
    runtime.log(`${m.symbol}: ${halts.get(m.symbol)?.active ? "halted" : "trading"} on Nasdaq, ${onchain.get(m.marketId) ? "halted" : "trading"} on Unison`);
  }
  const actions = haltDecisions(halts, cfg.markets, onchain);
  for (const a of actions) {
    const report = runtime.report(prepareReportRequest(encodeHalt(a.marketId, a.halted, a.reason))).result();
    const resp = evm
      .writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } })
      .result();
    if (resp.txStatus !== TxStatus.SUCCESS) throw new Error(`halt report failed: ${resp.errorMessage ?? resp.txStatus}`);
  }
  return actions.map((a) => `${a.marketId}:${a.halted ? "halt" : "resume"}`).join(",") || "no-change";
};

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
