/**
 * Mainnet beta, step 0: from the deployer key, fund the operator keys and buy the vault's starting assets on Monad
 * DEXes (KyberSwap's router), with hard limits: it aborts rather than swap at a bad price. Keys are read from
 * .secrets/mainnet.env and never printed.
 *
 *   node scripts/ops/mainnet-fund.mjs gas                fund keeper / relayer / guardian
 *   node scripts/ops/mainnet-fund.mjs mon-ausd <MON>      swap MON → AUSD (aborts below MIN_USD_PER_MON, default 0.030)
 *   node scripts/ops/mainnet-fund.mjs ausd-anvda <AUSD>   swap AUSD → aNVDA (aborts above MAX_USD_PER_SHARE, default 300)
 *   node scripts/ops/mainnet-fund.mjs balances
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, parseEther, parseUnits } from "viem";
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
} else {
  console.log("usage: gas | mon-ausd <MON> | ausd-anvda <AUSD> | balances");
}
