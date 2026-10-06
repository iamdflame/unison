#!/usr/bin/env node
/**
 * Replays the house adversary (src/bot.ts) over real history on both rules, and scores each leg the way the standing
 * challenge does (contracts/src/challenge/LatencyChallenge.sol). Read-only: Coinbase's public MON-USD trades and
 * Chainlink's MON/USD rounds on Monad mainnet.
 *
 *   node scripts/backtest.mjs                                    # from services/adversary: the last 72 h
 *   HOURS=168 THRESHOLDS=25,35,50 GAPS=0,1800 node scripts/backtest.mjs
 *
 * The model, each part a stated simplification:
 *   - the bot fires on a Coinbase trade priced THRESHOLD bp or more from the latest Chainlink round on chain: at most
 *     once per round, never while an order is open, at most once per GAP seconds; both legs at once, 10 WMON each;
 *   - its orders land a second later. The old rule (the control) clears a second after that, at the round on chain
 *     then. The causal rule (Unison) clears at the first round observed more than 2 s (the skew) after the orders
 *     landed, once that round is on chain;
 *   - the vault fills at its 20 bp half-spread plus 1 bp of depth (10 WMON walks about 2.5 of its 0.33 bp ticks), and
 *     the fee is 3 bp. A fill past the bot's limit (50 bp beyond the Coinbase price) doesn't happen. Inventory skew
 *     is left out;
 *   - each fill is marked at the first round observed 60 s or more after the order, as the challenge marks it, in USD
 *     (the contract divides by AUSD/USD, a difference far below a basis point).
 * A leg qualifies once it has 30 fills and its edge exceeds 2 bp of its notional, the challenge's terms.
 */
import { createPublicClient, http, parseAbi } from "viem";

const RPC = process.env.RPC_URL ?? "https://rpc-mainnet.monadinfra.com";
const FEED = "0xBcD78f76005B7515837af6b50c7C52BCf73822fb"; // MON/USD on Monad mainnet
const MC = "0xcA11bde05977b3631167028862bE2a173976CA11";
const HOURS = Number(process.env.HOURS ?? 72);
const THRESHOLDS = (process.env.THRESHOLDS ?? "25,30,35,50").split(",").map(Number);
const GAPS = (process.env.GAPS ?? "0,1800").split(",").map(Number);
const SKEW = 2;
const HORIZON = 60;
const HALF_SPREAD = 21e-4;
const FEE = 3e-4;
const SLIP = 50e-4;
const QTY = 10;
const EPS_BPS = 2;
const MIN_FILLS = 30;
const LAND = 1; // seconds from the signal to the order's block
const CLEAR = 1; // seconds from a block to the clear that prices it
const SETTLE = 3; // the bot's settle loop

const abi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);
const c = createPublicClient({ transport: http(RPC), batch: { multicall: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Math.floor(Date.now() / 1000);
const from = now - HOURS * 3600;

/** Chainlink's rounds from a little before the window to now, by observation time. */
async function rounds() {
  const dec = await c.readContract({ address: FEED, abi, functionName: "decimals" });
  const latest = await c.readContract({ address: FEED, abi, functionName: "latestRoundData" });
  const out = [];
  let id = latest[0];
  for (;;) {
    const ids = [];
    for (let k = 0n; k < 200n && ((id - k) & 0xffffffffffffffffn) > 0n; k++) ids.push(id - k);
    if (!ids.length) break;
    let res;
    for (let a = 0; a < 6 && !res; a++) {
      try {
        res = await c.multicall({ multicallAddress: MC, allowFailure: true, contracts: ids.map((x) => ({ address: FEED, abi, functionName: "getRoundData", args: [x] })) });
      } catch {
        await sleep(1500);
      }
    }
    if (!res) throw new Error("the RPC failed six times in a row");
    let oldest = Infinity;
    for (const r of res) {
      if (r.status !== "success" || r.result[3] === 0n) continue;
      out.push({ id: r.result[0], p: Number(r.result[1]) / 10 ** dec, obs: Number(r.result[2]), at: Number(r.result[3]) });
      oldest = Math.min(oldest, Number(r.result[2]));
    }
    id -= BigInt(ids.length);
    if (oldest < from - 3600) break;
  }
  return out.sort((a, b) => a.obs - b.obs);
}

/** Coinbase's MON-USD trades in the window, oldest first. */
async function trades() {
  const out = [];
  let after = "";
  for (;;) {
    const res = await fetch(`https://api.exchange.coinbase.com/products/MON-USD/trades?limit=1000${after ? `&after=${after}` : ""}`, {
      headers: { "User-Agent": "unison-backtest" },
    });
    if (res.status === 429) {
      await sleep(1000);
      continue;
    }
    if (!res.ok) throw new Error(`Coinbase answered ${res.status}`);
    const page = await res.json();
    if (!page.length) break;
    for (const t of page) out.push({ t: Date.parse(t.time) / 1000, p: Number(t.price) });
    after = res.headers.get("cb-after") ?? String(page.at(-1).trade_id);
    if (out.at(-1).t < from) break;
    await sleep(150);
  }
  return out.filter((x) => x.t >= from).sort((a, b) => a.t - b.t);
}

/** Smallest index i with key(xs[i]) > v (or xs.length). */
function above(xs, key, v) {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(xs[mid]) > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function simulate(rs, ts, threshold, gap) {
  // landing times never run backwards (measured: docs/evidence/causal.md), so "on chain at t" is a search on `at`
  const landed = (t) => rs[above(rs, (r) => r.at, t) - 1];
  const firstAfter = (t) => rs[above(rs, (r) => r.obs, t)];
  const legs = { control: [], unison: [] };
  let lastRound = -1n;
  let lastFired = -Infinity;
  let busyUntil = -Infinity;
  let fires = 0;
  const record = (leg, side, ref, limit, mark, placed) => {
    if (!ref || !mark) return;
    const px = side === 0 ? ref * (1 + HALF_SPREAD) : ref * (1 - HALF_SPREAD);
    if (side === 0 ? px > limit : px < limit) return; // IOC: past the limit, nothing fills
    const money = side === 0 ? QTY * px * (1 + FEE) : QTY * px * (1 - FEE);
    const worth = QTY * mark.p;
    legs[leg].push({ placed, edge: side === 0 ? worth - money : money - worth, notional: money, markedAt: mark.at });
  };
  for (const tr of ts) {
    if (tr.t < busyUntil || tr.t - lastFired < gap) continue;
    const cl = landed(tr.t);
    if (!cl || cl.id === lastRound) continue;
    const gapBps = (tr.p / cl.p - 1) * 1e4;
    if (Math.abs(gapBps) < threshold) continue;
    const side = gapBps > 0 ? 0 : 1;
    const limit = tr.p * (1 + (side === 0 ? SLIP : -SLIP));
    lastRound = cl.id;
    lastFired = tr.t;
    fires++;
    const placed = Math.floor(tr.t + LAND);
    const mark = rs[above(rs, (r) => r.obs, placed + HORIZON - 1)];
    record("control", side, landed(placed + CLEAR)?.p, limit, mark, placed);
    const first = firstAfter(placed + SKEW);
    record("unison", side, first?.p, limit, mark, placed);
    busyUntil = Math.max(placed + CLEAR, first ? first.at + CLEAR : Infinity) + SETTLE;
  }
  const score = (fills) => {
    let edge = 0;
    let notional = 0;
    let qualifiedAt = null;
    let best = -Infinity;
    fills.forEach((f, i) => {
      edge += f.edge;
      notional += f.notional;
      if (i + 1 >= MIN_FILLS) {
        const bps = (edge / notional) * 1e4;
        best = Math.max(best, bps);
        if (qualifiedAt === null && bps > EPS_BPS) qualifiedAt = f.markedAt;
      }
    });
    const per = fills.map((f) => (f.edge / f.notional) * 1e4).sort((a, b) => a - b);
    return {
      fills: fills.length,
      edgeBps: notional ? (edge / notional) * 1e4 : 0,
      median: per.length ? per[per.length >> 1] : 0,
      wins: per.length ? per.filter((x) => x > 0).length / per.length : 0,
      best: Number.isFinite(best) ? best : null,
      qualifiedAt,
    };
  };
  return { fires, control: score(legs.control), unison: score(legs.unison) };
}

const [rs, ts] = await Promise.all([rounds(), trades()]);
const t0 = Math.max(from, ts[0]?.t ?? from);
const t1 = Math.min(now, ts.at(-1)?.t ?? now);
const days = (t1 - t0) / 86400;
const inWindow = rs.filter((r) => r.obs >= t0 && r.obs <= t1);
console.log(`Window ${new Date(t0 * 1000).toISOString()} to ${new Date(t1 * 1000).toISOString()} (${(days * 24).toFixed(1)} h)`);
console.log(`${ts.length.toLocaleString("en-US")} Coinbase MON-USD trades, ${inWindow.length.toLocaleString("en-US")} Chainlink MON/USD rounds`);
console.log(`MON moved from $${inWindow[0]?.p.toFixed(5)} to $${inWindow.at(-1)?.p.toFixed(5)}\n`);
const h = (t) => (t === null ? "never" : `${((t - t0) / 3600).toFixed(1)} h`);
const f = (x, d = 1) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}`);
console.log("threshold  gap    fires/day | control: fills  edge bp  median  wins  qualifies | unison: fills  edge bp  median  wins  best prefix");
for (const th of THRESHOLDS) {
  for (const g of GAPS) {
    const r = simulate(rs, ts, th, g);
    const C = r.control;
    const U = r.unison;
    console.log(
      `${String(th).padStart(6)} bp ${String(g).padStart(5)} s ${String((r.fires / days).toFixed(0)).padStart(9)} | ${String(C.fills).padStart(14)} ${f(C.edgeBps).padStart(8)} ${f(C.median).padStart(7)} ${(C.wins * 100).toFixed(0).padStart(4)}% ${h(C.qualifiedAt).padStart(10)} | ${String(U.fills).padStart(13)} ${f(U.edgeBps).padStart(8)} ${f(U.median).padStart(7)} ${(U.wins * 100).toFixed(0).padStart(4)}% ${f(U.best).padStart(12)}`,
    );
  }
}
console.log(`\nqualifies: when the control leg would first meet the terms (${MIN_FILLS} fills, edge over ${EPS_BPS} bp of notional).`);
console.log("best prefix: Unison's highest edge over any prefix of 30 fills or more; the pot pays only above +2 bp.");
