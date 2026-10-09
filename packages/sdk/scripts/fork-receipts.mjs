/**
 * Makes the receipts the verifier's tests replay offline, on an anvil fork of Monad mainnet: the deployed exchange,
 * causal adapter and Chainlink feeds, with the clock moved to a Saturday. Nothing is sent to mainnet.
 *
 *   1. discovery: aNVDA (market 0) after its session closed (Saturday 00:00 UTC). Two fresh accounts cross inside the
 *      band, so the auction is a DISCOVERY call auction at Chainlink's last observation;
 *   2. halted: the same market halted with orders waiting. The next auction trades nothing and returns them.
 * Each receipt is checked with verifyReceipt against the fork, then every chain read is recorded the way
 * record-receipt.mjs records a mainnet one.
 *
 * A fork receives no oracle reports, so after the clock moves its AUSD/USD feed (hourly heartbeat, 3,900 s maximum age)
 * would read stale and the adapter would call the market HALTED. On mainnet the feed keeps beating through the weekend,
 * so the fork stands in a feed observed 75 s and landed 60 s before every block, at $0.9998 (FRESH_QUOTE_CODE, the runtime code of
 *
 *   contract FreshAggregator {
 *     function decimals() external pure returns (uint8) { return 8; }
 *     function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
 *       return (type(uint64).max, 99_980_000, block.timestamp - 75, block.timestamp - 60, type(uint64).max);
 *     }
 *     function getRoundData(uint80 r) external view returns (uint80, int256, uint256, uint256, uint80) {
 *       return (r, 99_980_000, block.timestamp - 75, block.timestamp - 60, r);
 *     }
 *   }
 *
 * plus description() and version(), compiled with solc 0.8.26 --optimize). The base feed, wNVDAx-USD, is Chainlink's own.
 *
 *   RECORD=1 node --conditions=development packages/sdk/scripts/fork-receipts.mjs   (needs anvil; RECORD=1 writes
 *   test/fixtures/, which hold one fork's blocks and rounds: the tests assert them, so rerecord only on purpose)
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseAbi } from "viem";
import { unisonExchangeAbi } from "../src/abis/index.ts";
import { verifyReceipt } from "../src/verify.ts";

const PORT = 8548;
// FORK_RPC: use an anvil fork already running there (and leave it running) instead of starting one
const LOCAL = process.env.FORK_RPC ?? `http://127.0.0.1:${PORT}`;
const EXCHANGE = "0x1696170d40E703F1378989383c21Ec96ED1Adf75";
const ADAPTER = "0xB161400dDfC592fD66b57dDaE46966ED74Ce891d";
const GUARDIAN = "0x0562b2b0914b3Bb082A623657729452fc9bf26E4";
const ANVDA = "0x701193374879131f923532987c7Ef363a91a80eB";
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
const AUSD_USD_FEED = "0xE20751C7B5867bCBef815ffc1b284c3f412a9e13";
const FRESH_QUOTE_CODE = "0x608060405234801561000f575f80fd5b5060043610610055575f3560e01c8063313ce5671461005957806354fd4d501461006d5780637284e4161461007c5780639a6fc8f5146100b2578063feaf968c146100fc575b5f80fd5b604051600881526020015b60405180910390f35b60405160048152602001610064565b6040805180820182526014815273199bdc9ace88199c995cda08105554d10bd554d160621b60208201529051610064919061017c565b6100c56100c03660046101b1565b610104565b6040805169ffffffffffffffffffff968716815260208101959095528401929092526060830152909116608082015260a001610064565b6100c5610137565b5f80808080856305f592e061011a604b426101e1565b610125603c426101e1565b92999198909750919550909350915050565b5f8080808067ffffffffffffffff6305f592e0610155604b426101e1565b610160603c426101e1565b67ffffffffffffffff9384169992985090965094509092509050565b602081525f82518060208401528060208501604085015e5f604082850101526040601f19601f83011684010191505092915050565b5f602082840312156101c1575f80fd5b813569ffffffffffffffffffff811681146101da575f80fd5b9392505050565b8181038181111561020057634e487b7160e01b5f52601160045260245ffd5b9291505056fea26469706673582212204797129afdb70745e85da9ddc150139bb5cea86bd85b63be2c236bcd4381be8564736f6c634300081a0033";
const MARKET = 0n;
// anvil's own unlocked accounts: not the team's
const SELLER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BUYER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const KEEPER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const SATURDAY = 1791594000n; // Sat 10 Oct 2026, 01:00 UTC: aNVDA's session ([Mon 00:00, Sat 00:00) UTC) is closed
const QTY = 10n ** 15n; // 0.001 aNVDA
const adapterAbi = parseAbi(["function latest(uint256) view returns (uint256 price, uint256 observedAt, uint8 status, uint80 round)"]);

const bin = process.env.ANVIL ?? join(homedir(), ".foundry", "bin", process.platform === "win32" ? "anvil.exe" : "anvil");
const anvil = process.env.FORK_RPC
  ? null
  : spawn(bin, ["--fork-url", process.env.FORK_URL ?? "https://rpc.monad.xyz", "--port", String(PORT), "--chain-id", "143", "--silent"], { stdio: "ignore" });
// a fork fetches every storage slot a call touches first from the remote endpoint: a clear can take minutes
const client = createPublicClient({ transport: http(LOCAL, { timeout: 600_000 }) });
const wallet = createWalletClient({ transport: http(LOCAL, { timeout: 600_000 }) });
const rpc = (method, params = []) => client.request({ method, params });

async function waitForRpc() {
  for (let i = 0; i < 120; i++) {
    try {
      return await client.getBlockNumber();
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("anvil didn't start");
}

async function send(from, to, abi, functionName, args) {
  // simulate first: a revert comes back with its custom error's name
  await client.simulateContract({ account: from, address: to, abi, functionName, args });
  // a fixed, generous limit: anvil's estimate can leave an SSTORE under its 2,300-gas floor (EIP-2200)
  const hash = await wallet.sendTransaction({ account: from, chain: null, to, data: encodeFunctionData({ abi, functionName, args }), gas: 5_000_000n });
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") {
    const t = await client.getTransaction({ hash });
    const why = await client
      .call({ account: from, to, data: t.input, gas: t.gas, blockNumber: r.blockNumber - 1n })
      .then(() => "a replay at the block before succeeds")
      .catch((e) => e.shortMessage ?? e.message);
    throw new Error(`${functionName} reverted (gas used ${r.gasUsed} of ${t.gas}): ${why}`);
  }
  return r;
}

/** Every read verifyReceipt makes, with its answer, so the test replays it with no network. */
async function record(tx, file, meta) {
  const calls = [];
  const key = (method, args) => JSON.stringify([method, args], (_, v) => (typeof v === "bigint" ? `${v}n` : v));
  const recording = new Proxy(client, {
    get(target, prop) {
      if (!["getTransactionReceipt", "getBlock", "readContract", "getLogs"].includes(prop)) return target[prop];
      return async (args) => {
        const slim =
          prop === "readContract"
            ? { address: args.address, functionName: args.functionName, args: args.args, blockNumber: args.blockNumber }
            : prop === "getLogs"
              ? { address: args.address, args: args.args, fromBlock: args.fromBlock, toBlock: args.toBlock }
              : args;
        try {
          const result = await target[prop](args);
          const kept =
            prop === "getTransactionReceipt"
              ? { blockNumber: result.blockNumber, logs: result.logs.map((l) => ({ address: l.address, data: l.data, topics: l.topics })) }
              : prop === "getBlock"
                ? { number: result.number, timestamp: result.timestamp }
                : prop === "getLogs"
                  ? result.map((l) => ({ blockNumber: l.blockNumber, args: l.args }))
                  : result;
          calls.push({ key: key(prop, slim), result: kept });
          return kept;
        } catch (e) {
          calls.push({ key: key(prop, slim), error: String(e.shortMessage ?? e.message) });
          throw e;
        }
      };
    },
  });
  const v = await verifyReceipt(recording, tx);
  for (const s of v.steps) console.log(`  ${s.kind === "check" ? (s.ok ? "PASS" : "FAIL") : s.kind.toUpperCase().padEnd(4)}  ${s.what}`);
  if (!v.ok) throw new Error(`${file}: the receipt does not verify; not recording it as a passing fixture`);
  console.log(`  clear ${tx}: market ${v.marketId}, auction of block ${v.upToBlock}, ${v.rule}`);
  if (process.env.RECORD !== "1") return;
  writeFileSync(new URL(`../test/fixtures/${file}`, import.meta.url), JSON.stringify({ ...meta, tx, rule: v.rule, calls }, (_, x) => (typeof x === "bigint" ? `${x}n` : x), 2) + "\n");
  console.log(`  → test/fixtures/${file} (${v.rule}, ${v.checks} checks)`);
}

async function placePair(refTick) {
  await send(SELLER, EXCHANGE, unisonExchangeAbi, "placeOrder", [MARKET, 1n, refTick - 1n, QTY, 1n]);
  const r = await send(BUYER, EXCHANGE, unisonExchangeAbi, "placeOrder", [MARKET, 0n, refTick + 1n, QTY, 1n]);
  return r.blockNumber;
}

async function clear(upTo) {
  await rpc("evm_mine");
  return send(KEEPER, EXCHANGE, unisonExchangeAbi, "clearUpTo", [MARKET, upTo, "0x"]);
}

try {
  const forkBlock = await waitForRpc();
  console.log(`anvil fork of Monad mainnet at block ${forkBlock}`);
  for (const a of [EXCHANGE, GUARDIAN]) {
    await rpc("anvil_impersonateAccount", [a]);
    await rpc("anvil_setBalance", [a, "0x3635C9ADC5DEA00000"]);
  }
  // fund two fresh accounts from the exchange's custody, on the fork only
  await send(EXCHANGE, ANVDA, erc20Abi, "transfer", [SELLER, 4n * QTY]);
  await send(EXCHANGE, AUSD, erc20Abi, "transfer", [BUYER, 4_000_000n]);
  await send(SELLER, ANVDA, erc20Abi, "approve", [EXCHANGE, 4n * QTY]);
  await send(SELLER, EXCHANGE, unisonExchangeAbi, "deposit", [ANVDA, 4n * QTY]);
  await send(BUYER, AUSD, erc20Abi, "approve", [EXCHANGE, 4_000_000n]);
  await send(BUYER, EXCHANGE, unisonExchangeAbi, "deposit", [AUSD, 4_000_000n]);

  await rpc("anvil_setCode", [AUSD_USD_FEED, FRESH_QUOTE_CODE]);
  // Saturday: the session is closed, and the last observation came before any order
  await rpc("evm_setNextBlockTimestamp", [`0x${SATURDAY.toString(16)}`]);
  await rpc("evm_mine");
  const [price, observedAt, status] = await client.readContract({ address: ADAPTER, abi: adapterAbi, functionName: "latest", args: [MARKET] });
  const refTick = (price + 5_000n) / 10_000n;
  console.log(`aNVDA's last observation: ${price} at ${observedAt}, status ${status} (2 = CLOSED); reference tick ${refTick}`);

  console.log("1. a DISCOVERY call auction");
  const upTo1 = await placePair(refTick);
  const c1 = await clear(upTo1);
  await record(c1.transactionHash, "receipt-discovery-fork.json", { forkBlock, note: "anvil fork of Monad mainnet, Sat 10 Oct 2026: aNVDA after its session closed" });

  console.log("2. a halted auction");
  await send(GUARDIAN, EXCHANGE, unisonExchangeAbi, "setHalt", [MARKET, true]);
  const upTo2 = await placePair(refTick);
  const c2 = await clear(upTo2);
  await record(c2.transactionHash, "receipt-halted-fork.json", { forkBlock, note: "anvil fork of Monad mainnet, Sat 10 Oct 2026: aNVDA halted with orders waiting" });
} finally {
  anvil?.kill();
}
