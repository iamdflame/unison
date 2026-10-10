/**
 * After the handover (docs/GO_LIVE.md, Phase A), every admin change is a timelocked operation: the admin Safe sends
 * `schedule` to the timelock, then anyone sends `execute` once the delay has passed. This prints both transactions,
 * ready to paste into the Safe's transaction builder (to, value, data). It reads the chain and the deployment record
 * only: it holds no key and sends nothing.
 *
 *   node --conditions=development apps/web/scripts/ops/timelock-calldata.mjs dst <winter|summer>
 *       aNVDA's weekly session window for US daylight time (ends 1 Nov 2026, starts again 14 Mar 2027).
 *       winter: Mon 01:00 → Sat 01:00 UTC [3600, 435600]; summer: Mon 00:00 → Sat 00:00 UTC [0, 432000].
 *   node --conditions=development apps/web/scripts/ops/timelock-calldata.mjs call <target> "<function signature>" [args…]
 *       any call, e.g. call 0xExchange "setKeeperReward(uint256)" 0
 *
 * SALT=<label> names the operation (default: a label derived from the call); RECORD=deployments/<name>.json picks
 * the deployment (default monad-mainnet).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, encodeFunctionData, http, isAddress, keccak256, parseAbi, parseAbiItem, toHex, zeroHash } from "viem";
import { monad } from "@unison/sdk";

const root = process.cwd();
const RECORD = process.env.RECORD ?? "deployments/monad-mainnet.json";
const dep = JSON.parse(readFileSync(join(root, RECORD), "utf8"));
const pub = createPublicClient({ chain: monad, transport: http(process.env.RPC_URL ?? "https://rpc.monad.xyz") });

const timelockAbi = parseAbi([
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt) payable",
  "function hashOperation(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function getMinDelay() view returns (uint256)",
]);
const feedsAbi = parseAbi([
  "function feeds(uint256) view returns (address base, address quote, uint8 baseDecimals, uint8 quoteFeedDecimals, uint8 quoteTokenDecimals, uint32 maxAgeSec, uint32 quoteMaxAgeSec, uint32 openSec, uint32 closeSec, uint16 depegBps, bool set)",
  "function setFeed(uint256 marketId, address base, address quote, uint8 quoteTokenDecimals, uint32 maxAgeSec, uint32 quoteMaxAgeSec, uint32 openSec, uint32 closeSec, uint16 depegBps)",
]);

/** The operation the timelock will run: `target.call(data)`. */
async function print(target, data, label, what) {
  const salt = keccak256(toHex(process.env.SALT ?? label));
  const out = { what, target, data, salt };
  if (!dep.timelock) {
    console.log(JSON.stringify({ ...out, note: `${RECORD} names no timelock yet: the deployer can send this call itself` }, null, 2));
    return;
  }
  const delay = await pub.readContract({ address: dep.timelock, abi: timelockAbi, functionName: "getMinDelay" });
  const id = await pub.readContract({ address: dep.timelock, abi: timelockAbi, functionName: "hashOperation", args: [target, 0n, data, zeroHash, salt] });
  const schedule = encodeFunctionData({ abi: timelockAbi, functionName: "schedule", args: [target, 0n, data, zeroHash, salt, delay] });
  const execute = encodeFunctionData({ abi: timelockAbi, functionName: "execute", args: [target, 0n, data, zeroHash, salt] });
  console.log(
    JSON.stringify(
      {
        ...out,
        operationId: id,
        delaySec: delay.toString(),
        "1. the admin Safe sends": { to: dep.timelock, value: "0", data: schedule },
        "2. anyone sends, once the delay has passed": { to: dep.timelock, value: "0", data: execute },
        "executable from (if scheduled now)": new Date(Date.now() + Number(delay) * 1000).toISOString(),
      },
      null,
      2,
    ),
  );
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "dst") {
  const season = args[0];
  if (season !== "winter" && season !== "summer") throw new Error("usage: dst <winter|summer>");
  const nvda = Object.values(dep.markets).find((m) => m.symbol === "aNVDA/AUSD");
  if (!nvda || !dep.causalReference) throw new Error(`no aNVDA market or causal adapter in ${RECORD}`);
  const f = await pub.readContract({ address: dep.causalReference, abi: feedsAbi, functionName: "feeds", args: [BigInt(nvda.id)] });
  const [base, quote, , , quoteTokenDecimals, maxAgeSec, quoteMaxAgeSec, openSec, closeSec, depegBps, set] = f;
  if (!set) throw new Error("aNVDA has no feed on the causal adapter");
  const [open, close] = season === "winter" ? [3_600, 435_600] : [0, 432_000];
  if (openSec === open && closeSec === close) console.error(`note: the window is already [${open}, ${close}]`);
  const data = encodeFunctionData({
    abi: feedsAbi,
    functionName: "setFeed",
    args: [BigInt(nvda.id), base, quote, quoteTokenDecimals, maxAgeSec, quoteMaxAgeSec, open, close, depegBps],
  });
  await print(
    dep.causalReference,
    data,
    `unison.dst.${season}.${new Date().getUTCFullYear()}`,
    `aNVDA's session window [${openSec}, ${closeSec}] → [${open}, ${close}] (US ${season === "winter" ? "standard" : "daylight"} time), every other setting unchanged`,
  );
} else if (cmd === "call") {
  const [target, signature, ...callArgs] = args;
  if (!target || !isAddress(target) || !signature) throw new Error('usage: call <target> "<function signature>" [args…]');
  const item = parseAbiItem(`function ${signature.replace(/^function\s+/, "")}`);
  const typed = item.inputs.map((input, i) => {
    const v = callArgs[i];
    if (v === undefined) throw new Error(`missing argument ${i + 1} (${input.type})`);
    if (/^u?int/.test(input.type)) return BigInt(v);
    if (input.type === "bool") return v === "true";
    return v;
  });
  const data = encodeFunctionData({ abi: [item], functionName: item.name, args: typed });
  await print(target, data, `unison.call.${item.name}.${Date.now()}`, `${target}.${signature} (${callArgs.join(", ")})`);
} else {
  throw new Error("usage: dst <winter|summer> | call <target> \"<signature>\" [args…]");
}
