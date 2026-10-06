/**
 * Records every chain read verifyReceipt makes for one auction, so test/verify.test.ts replays a real mainnet receipt
 * offline. Read-only.
 *
 *   node packages/sdk/scripts/record-receipt.mjs <clear tx hash> > packages/sdk/test/fixtures/receipt-<upTo>.json
 */
import { createPublicClient, http } from "viem";
import { verifyReceipt } from "../src/verify.ts";

const tx = process.argv[2];
const real = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.monad.xyz") });
const calls = [];
const key = (method, args) => JSON.stringify([method, args], (_, v) => (typeof v === "bigint" ? `${v}n` : v));
const recording = new Proxy(real, {
  get(target, prop) {
    if (!["getTransactionReceipt", "getBlock", "readContract"].includes(prop)) return target[prop];
    return async (args) => {
      const slim = prop === "readContract" ? { address: args.address, functionName: args.functionName, args: args.args, blockNumber: args.blockNumber } : args;
      const result = await target[prop](args);
      const kept =
        prop === "getTransactionReceipt"
          ? { blockNumber: result.blockNumber, logs: result.logs.map((l) => ({ address: l.address, data: l.data, topics: l.topics })) }
          : prop === "getBlock"
            ? { number: result.number, timestamp: result.timestamp }
            : result;
      calls.push({ key: key(prop, slim), result: kept });
      return kept;
    };
  },
});
const v = await verifyReceipt(recording, tx);
if (!v.ok) throw new Error("the receipt does not verify; not recording it as a passing fixture");
console.log(JSON.stringify({ tx, calls }, (_, x) => (typeof x === "bigint" ? `${x}n` : x), 2));
