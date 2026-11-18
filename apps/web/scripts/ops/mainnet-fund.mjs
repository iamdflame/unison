/**
 * Mainnet beta, step 0: from the deployer key, fund the operator keys and buy the vault's starting assets on Monad
 * DEXes (KyberSwap's router), with hard limits: it aborts rather than swap at a bad price. Keys are read from
 * .secrets/mainnet.env and never printed.
 *
 *   node scripts/ops/mainnet-fund.mjs gas                fund keeper / relayer / guardian
 *   node scripts/ops/mainnet-fund.mjs keeper <MON>       top the keeper up by <MON>
 *   node scripts/ops/mainnet-fund.mjs mon-ausd <MON>      swap MON → AUSD (aborts below MIN_USD_PER_MON, default 0.030)
 *   node scripts/ops/mainnet-fund.mjs ausd-anvda <AUSD>   swap AUSD → aNVDA (aborts above MAX_USD_PER_SHARE, default 300)
 *   node scripts/ops/mainnet-fund.mjs balances
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, getAddress, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "@unison/sdk";

const env = Object.fromEntries(
  readFileSync(new URL("../../../../.secrets/mainnet.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.trim().split("=")),
);
const RPC = process.env.RPC_URL ?? "https://rpc-mainnet.monadinfra.com";
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";
const ANVDA = "0x701193374879131f923532987c7Ef363a91a80eB";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const KYBER = "https://aggregator-api.kyberswap.com/monad/api/v1";

const deployer = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const wallet = createWalletClient({ chain: monad, transport: http(RPC), account: deployer });
const wait = async (hash, what) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${what}: ${r.status} ${hash}`);
  if (r.status !== "success") throw new Error(`${what} reverted`);
  return r;
};

async function balances() {
  for (const n of ["DEPLOYER", "KEEPER", "RELAYER", "GUARDIAN"]) {
    const a = env[`${n}_ADDRESS`];
    const [mon, ausd, anvda] = await Promise.all([
      pub.getBalance({ address: a }),
      pub.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
      pub.readContract({ address: ANVDA, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
    ]);
    console.log(`${n.padEnd(8)} ${a}  ${Number(formatEther(mon)).toFixed(3)} MON  ${formatUnits(ausd, 6)} AUSD  ${formatUnits(anvda, 18)} aNVDA`);
  }
}

async function swap(tokenIn, tokenOut, amountIn, check) {
  const q = await (await fetch(`${KYBER}/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}`, { headers: { "x-client-id": "unison" } })).json();
  if (q.code !== 0) throw new Error(`no route: ${q.message}`);
  const out = BigInt(q.data.routeSummary.amountOut);
  check(out); // throws when the price is outside the limit
  const b = await (
    await fetch(`${KYBER}/route/build`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": "unison" },
      body: JSON.stringify({ routeSummary: q.data.routeSummary, sender: deployer.address, recipient: deployer.address, slippageTolerance: 100, deadline: Math.floor(Date.now() / 1000) + 600 }),
    })
  ).json();
  if (b.code !== 0) throw new Error(`build failed: ${b.message}`);
  const router = b.data.routerAddress;
  if (tokenIn !== NATIVE) {
    const allowance = await pub.readContract({ address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [deployer.address, router] });
    if (allowance < amountIn) await wait(await wallet.writeContract({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [router, amountIn] }), "approve router");
  }
  // the aggregator estimates gas by Ethereum's schedule; Monad prices cold state differently (and charges the limit),
  // so ask Monad itself, with a margin
  const value = tokenIn === NATIVE ? amountIn : 0n;
  const est = await pub.estimateGas({ account: deployer, to: router, data: b.data.data, value });
  const gas = (est * 125n) / 100n;
  await wait(await wallet.sendTransaction({ to: router, data: b.data.data, value, gas }), "swap");
  return out;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "balances") await balances();
else if (cmd === "gas") {
  for (const [n, amt] of [["KEEPER", "100"], ["RELAYER", "40"], ["GUARDIAN", "2"]]) {
    await wait(await wallet.sendTransaction({ to: env[`${n}_ADDRESS`], value: parseEther(amt) }), `${amt} MON → ${n.toLowerCase()}`);
  }
  await balances();
} else if (cmd === "keeper") {
  if (!arg || !(Number(arg) > 0)) throw new Error("usage: keeper <MON>");
  await wait(await wallet.sendTransaction({ to: env.KEEPER_ADDRESS, value: parseEther(arg) }), `${arg} MON → keeper`);
  await balances();
} else if (cmd === "mon-ausd") {
  const minUsd = Number(process.env.MIN_USD_PER_MON ?? "0.030");
  const amountIn = parseEther(arg);
  await swap(NATIVE, AUSD, amountIn, (out) => {
    const px = Number(formatUnits(out, 6)) / Number(arg);
    console.log(`quote: ${arg} MON → ${formatUnits(out, 6)} AUSD ($${px.toFixed(5)}/MON)`);
    if (px < minUsd) throw new Error(`price $${px.toFixed(5)}/MON is below the $${minUsd} floor: not swapping`);
  });
  await balances();
} else if (cmd === "ausd-anvda") {
  const maxPx = Number(process.env.MAX_USD_PER_SHARE ?? "300");
  const amountIn = parseUnits(arg, 6);
  await swap(AUSD, ANVDA, amountIn, (out) => {
    const px = Number(arg) / Number(formatUnits(out, 18));
    console.log(`quote: ${arg} AUSD → ${formatUnits(out, 18)} aNVDA ($${px.toFixed(2)}/share)`);
    if (px > maxPx) throw new Error(`price $${px.toFixed(2)}/share is above the $${maxPx} cap: not swapping`);
  });
  await balances();
} else if (cmd === "relayer") {
  if (!arg || !(Number(arg) > 0)) throw new Error("usage: relayer <MON>");
  await wait(await wallet.sendTransaction({ to: env.RELAYER_ADDRESS, value: parseEther(arg) }), `${arg} MON → relayer`);
  await balances();
} else if (cmd === "to-usdc") {
  // winding down: everything the deployer holds becomes native USDC on Monad, each swap refused when it pays less than
  // a floor taken from Chainlink's own price (or the dollar's peg). Keeps RESERVE_MON (default 3) for gas.
  const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
  const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
  const feed = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function decimals() view returns (uint8)"]);
  const usdOf = async (agg) => {
    const [[, answer], dec] = await Promise.all([pub.readContract({ address: agg, abi: feed, functionName: "latestRoundData" }), pub.readContract({ address: agg, abi: feed, functionName: "decimals" })]);
    return Number(answer) / 10 ** dec;
  };
  const monUsd = await usdOf("0xBcD78f76005B7515837af6b50c7C52BCf73822fb");
  const nvdaUsd = await usdOf("0x03ffa4673c060339E6a8E5Ba1a12B3301c966bf0");
  console.log(`Chainlink: MON $${monUsd.toFixed(5)}, wNVDAx $${nvdaUsd.toFixed(2)}`);
  const floor = (name, inUnits, inDec, usdEach, minShare) => (out) => {
    const got = Number(formatUnits(out, 6));
    const fair = Number(formatUnits(inUnits, inDec)) * usdEach;
    console.log(`quote: ${formatUnits(inUnits, inDec)} ${name} → ${got.toFixed(6)} USDC (fair $${fair.toFixed(4)})`);
    if (got < fair * minShare) throw new Error(`${name}: ${got.toFixed(4)} USDC is under ${(minShare * 100).toFixed(0)}% of fair: not swapping`);
  };
  const bal = (t) => pub.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [deployer.address] });
  const tryIt = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      console.log(`${what}: skipped (${e.message.slice(0, 140)})`);
    }
  };
  const ausd = await bal(AUSD);
  if (ausd > 0n) await tryIt("AUSD", () => swap(AUSD, usdc, ausd, floor("AUSD", ausd, 6, 1, 0.985)));
  const nv = await bal(ANVDA);
  if (nv > 0n) await tryIt("aNVDA", () => swap(ANVDA, usdc, nv, floor("aNVDA", nv, 18, nvdaUsd, 0.85)));
  const wm = await bal(WMON);
  if (wm > 0n) await tryIt("WMON", () => swap(WMON, usdc, wm, floor("WMON", wm, 18, monUsd, 0.9)));
  const reserve = parseEther(process.env.RESERVE_MON ?? "3");
  const mon = (await pub.getBalance({ address: deployer.address })) - reserve;
  if (mon > 0n) await tryIt("MON", () => swap(NATIVE, usdc, mon, floor("MON", mon, 18, monUsd, 0.9)));
  console.log(`deployer now holds ${formatUnits(await bal(usdc), 6)} USDC, ${formatUnits(await bal(AUSD), 6)} AUSD, ${formatUnits(await bal(ANVDA), 18)} aNVDA, ${formatUnits(await bal(WMON), 18)} WMON, ${formatEther(await pub.getBalance({ address: deployer.address }))} MON`);
} else if (cmd === "send-usdc") {
  // the recovered USDC to an address: an amount, or "all"
  const usdc = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
  const [, to, amt] = process.argv.slice(2);
  if (!to || !isAddress(to) || !amt) throw new Error("usage: send-usdc <0x address> <USDC amount | all>");
  const have = await pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [deployer.address] });
  const value = amt === "all" ? have : parseUnits(amt, 6);
  if (value === 0n || value > have) throw new Error(`have ${formatUnits(have, 6)} USDC, asked for ${amt}`);
  await wait(await wallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "transfer", args: [getAddress(to), value] }), `send ${formatUnits(value, 6)} USDC → ${getAddress(to)}`);
} else {
  console.log("usage: gas | mon-ausd <MON> | ausd-anvda <AUSD> | relayer <MON> | to-usdc | send-usdc <to> <amount|all> | balances");
}
