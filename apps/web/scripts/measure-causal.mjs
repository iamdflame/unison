#!/usr/bin/env node
/**
 * Measures, from Chainlink's own history on Monad mainnet, what the causal clock costs and what the old rule leaked
 * (docs/evidence/causal.md). Read-only; public RPC.
 *
 *   node scripts/measure-causal.mjs            # from apps/web
 *   RPC_URL=… ROUNDS_MON=6000 node scripts/measure-causal.mjs
 *
 * Per feed:
 *   - observation → on chain: Chainlink's `startedAt` (the observation time inside the report the oracle quorum
 *     signed) against `updatedAt` (when the report landed on chain), and whether observation times ever go backwards;
 *   - the wait: for an order placed at a uniformly random moment, the time until the first observation made after
 *     it has landed on chain (what a causal auction waits);
 *   - the old rule's gap: how far each new observation moved from the last one on chain, which is what a trader
 *     watching the market knows during the ~13 s before it lands, while the old rule still quotes the previous one.
 */
import { createPublicClient, http, parseAbi } from "viem";

const RPC = process.env.RPC_URL ?? "https://rpc-mainnet.monadinfra.com";
const MC = "0xcA11bde05977b3631167028862bE2a173976CA11";
const abi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
]);
const FEEDS = [
  ["MON/USD", "0xBcD78f76005B7515837af6b50c7C52BCf73822fb", Number(process.env.ROUNDS_MON ?? 6000), false],
  ["wNVDAx-USD", "0x03ffa4673c060339E6a8E5Ba1a12B3301c966bf0", Number(process.env.ROUNDS_NVDA ?? 1500), true],
  ["GBP/USD", "0x1ffC8B75a16FFfbd7879F042B580F7607Dcf5C30", Number(process.env.ROUNDS_GBP ?? 600), false],
];
const c = createPublicClient({ transport: http(RPC), batch: { multicall: false } });
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const t = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`);
// US regular hours, New York (EDT in October: UTC-4)
const usHours = (ts) => {
  const d = new Date((ts - 4 * 3600) * 1000);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && h >= 9.5 && h < 16;
};

const block = await c.getBlockNumber();
console.log(`Monad mainnet, block ${block}, ${new Date().toISOString()}\n`);
for (const [name, addr, n, equity] of FEEDS) {
  const latest = await c.readContract({ address: addr, abi, functionName: "latestRoundData" });
  const ids = [];
  for (let k = 0n; k < BigInt(n); k++) ids.push(latest[0] - k);
  const rows = [];
  for (let i = 0; i < ids.length; i += 200) {
    let res;
    for (let a = 0; a < 6 && !res; a++) {
      try {
        res = await c.multicall({ multicallAddress: MC, allowFailure: true, contracts: ids.slice(i, i + 200).map((id) => ({ address: addr, abi, functionName: "getRoundData", args: [id] })) });
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    for (const r of res ?? []) if (r.status === "success" && r.result[3] > 0n) rows.push({ p: Number(r.result[1]), obs: Number(r.result[2]), at: Number(r.result[3]) });
  }
  rows.sort((a, b) => a.obs - b.obs);
  const delay = rows.map((r) => r.at - r.obs);
  const backwards = rows.slice(1).filter((r, i) => r.obs <= rows[i].obs).length;
  const notBefore = rows.filter((r) => r.obs >= r.at).length;
  const t0 = rows[0].obs;
  const t1 = rows.at(-1).obs;
  const wait = [];
  const waitUs = [];
  const waitOff = [];
  let j = 0;
  const step = Math.max(1, Math.floor((t1 - t0) / 20_000));
  for (let s = t0; s < t1; s += step) {
    while (j < rows.length && rows[j].obs <= s) j++;
    if (j >= rows.length) break;
    const w = rows[j].at - s;
    wait.push(w);
    (usHours(s) ? waitUs : waitOff).push(w);
  }
  const moves = rows.slice(1).map((r, i) => Math.abs(r.p / rows[i].p - 1) * 1e4);
  const hours = (t1 - t0) / 3600;
  console.log(`## ${name} (${addr})`);
  console.log(`${rows.length} rounds, ${new Date(t0 * 1000).toISOString().slice(0, 16)}Z → ${new Date(t1 * 1000).toISOString().slice(0, 16)}Z (${hours.toFixed(1)} h)`);
  console.log(`- observation → on chain: p50 ${t(q(delay, 0.5))}, p90 ${t(q(delay, 0.9))}, max ${t(Math.max(...delay))}; observed at or after landing: ${notBefore}; out of order: ${backwards}`);
  console.log(`- causal wait (order → first observation after it, on chain): p50 ${t(q(wait, 0.5))}, p90 ${t(q(wait, 0.9))}, p99 ${t(q(wait, 0.99))}`);
  if (equity && waitUs.length > 50) console.log(`  US market hours: p50 ${t(q(waitUs, 0.5))}, p90 ${t(q(waitUs, 0.9))}; other hours: p50 ${t(q(waitOff, 0.5))}, p90 ${t(q(waitOff, 0.9))}`);
  console.log(`- each observation's move from the one before it: p50 ${q(moves, 0.5).toFixed(1)} bp, p90 ${q(moves, 0.9).toFixed(1)} bp, p99 ${q(moves, 0.99).toFixed(1)} bp, max ${Math.max(...moves).toFixed(1)} bp`);
  for (const x of [5, 13, 23]) {
    const k = moves.filter((m) => m > x).length;
    console.log(`  moves over ${x} bp: ${((k / moves.length) * 100).toFixed(1)}% of rounds, ${(k / hours).toFixed(1)} an hour`);
  }
  console.log();
}
