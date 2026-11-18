/**
 * Every recoverable balance of the mainnet beta, read-only: what each team wallet holds, what each sits on inside the
 * exchange's ledger, the vaults' shares and NAV, the challenge pots, and the protocol's fee ledger. Sends nothing.
 *
 *   node --conditions=development apps/web/scripts/ops/inventory.mjs      (from the repository root)
 */
import { readFileSync } from "node:fs";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http, parseAbi } from "viem";
import { monad } from "@unison/sdk";

const d = JSON.parse(readFileSync("deployments/monad-mainnet.json", "utf8"));
const client = createPublicClient({ chain: monad, transport: http("https://rpc.monad.xyz", { retryCount: 3 }) });
const T = { AUSD: [d.tokens.AUSD.address, 6], WMON: [d.tokens.WMON.address, 18], aNVDA: [d.tokens.aNVDA.address, 18] };
const ex = d.exchange;
const exAbi = parseAbi(["function balanceOf(address account, address token) view returns (uint256)"]);
const vaultAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function nav() view returns (uint256)"]);
const SPONSOR = "0x1CD2B147EfE092c3BdE0B474bCE3Bd33ae3dbB37";

const who = {
  deployer: d.accounts.deployer,
  keeper: d.accounts.keeper,
  relayer: d.accounts.relayer,
  guardian: d.accounts.guardian,
  adversary: d.adversary.address,
  "adversary acct (unison)": d.adversary.accounts[0],
  "adversary acct (control)": d.adversary.accounts[1],
  agentWallet: d.accounts.agentWallet,
  ownerPasskey: d.accounts.ownerPasskey,
  "owner wallet (sponsor)": SPONSOR,
};

const fmt = (v, dec) => Number(formatUnits(v, dec)).toLocaleString("en-US", { maximumFractionDigits: 6 });
console.log("WALLETS (on chain) and their EXCHANGE LEDGER balances");
for (const [name, a] of Object.entries(who)) {
  const mon = await client.getBalance({ address: a });
  const parts = [`${Number(formatEther(mon)).toFixed(3)} MON`];
  for (const [sym, [tok, dec]] of Object.entries(T)) {
    const w = await client.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [a] });
    const l = await client.readContract({ address: ex, abi: exAbi, functionName: "balanceOf", args: [a, tok] });
    if (w > 0n) parts.push(`${fmt(w, dec)} ${sym}`);
    if (l > 0n) parts.push(`[ledger ${fmt(l, dec)} ${sym}]`);
  }
  console.log(`  ${name.padEnd(26)} ${a}  ${parts.join("  ")}`);
}

console.log("VAULTS (shares are what can be redeemed)");
for (const [name, m] of Object.entries(d.markets)) {
  const v = m.vault;
  const [supply, nav] = await Promise.all([
    client.readContract({ address: v, abi: vaultAbi, functionName: "totalSupply" }),
    client.readContract({ address: v, abi: vaultAbi, functionName: "nav" }).catch(() => null),
  ]);
  const holders = [];
  for (const [n, a] of Object.entries(who)) {
    const s = await client.readContract({ address: v, abi: vaultAbi, functionName: "balanceOf", args: [a] });
    if (s > 0n) holders.push(`${n} ${((Number(s) / Number(supply)) * 100).toFixed(1)}%`);
  }
  const held = [];
  for (const [sym, [tok, dec]] of Object.entries(T)) {
    const l = await client.readContract({ address: ex, abi: exAbi, functionName: "balanceOf", args: [v, tok] });
    if (l > 0n) held.push(`${fmt(l, dec)} ${sym}`);
  }
  console.log(`  ${name.padEnd(22)} ${v}  NAV ${nav === null ? "?" : fmt(nav, 6) + " AUSD"}  holds ${held.join(" + ") || "nothing"}  shares: ${holders.join(", ") || "none of ours"}`);
}

console.log("CHALLENGE POTS and PROTOCOL FEES");
for (const [name, c] of Object.entries(d.challenge)) {
  if (typeof c !== "string") continue;
  const pot = await client.readContract({ address: T.AUSD[0], abi: erc20Abi, functionName: "balanceOf", args: [c] });
  console.log(`  pot ${name.padEnd(8)} ${c}  ${fmt(pot, 6)} AUSD`);
}
for (const [sym, [tok, dec]] of Object.entries(T)) {
  const l = await client.readContract({ address: ex, abi: exAbi, functionName: "balanceOf", args: [ex, tok] });
  if (l > 0n) console.log(`  protocol fees            ${fmt(l, dec)} ${sym}`);
}
