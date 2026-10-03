/**
 * Latency-sniper benchmark (docs/evidence/fairness.md).
 *
 * One price path — GBM at NVDA-like volatility plus Poisson news jumps, 300 ms blocks — and the same actors on
 * four venue designs:
 *   A. xy=k AMM (passive LPs, fee f)                    — arbitrage every block = LVR
 *   B. push-oracle AMM (quotes oracle ± s, Chainlink-style deviation/heartbeat updates)
 *   C. CLOB with market makers (quotes refreshed with one block of latency; races decided by a coin flip)
 *   D. Unison FBA — the actual @unison/engine clearing: one uniform price per block, reference published
 *      AFTER the batch closes, LiquidityVault curve centred on that reference
 * Actors: one sniper with an instant true-price feed (trades whenever it sees an edge), Poisson noise traders.
 * Everything is in USD; P&L marked to the true price. Results are scaled to one day (288,000 blocks).
 *
 *   pnpm --filter @unison/sniper-bench bench            (BLOCKS=… SEED=… to change)
 */
import { apportionAll, compute } from "@unison/engine";

// ------------------------------------------------------------------ parameters
const BLOCKS = Number(process.env.BLOCKS ?? 1_000_000);
const SEED = Number(process.env.SEED ?? 42);
const BLOCK_S = 0.3;
const BLOCKS_PER_DAY = 86_400 / BLOCK_S;
const P0 = 180;
const SIGMA = 0.45; // annualized, incl. after-hours
const JUMPS_PER_DAY = 24;
const JUMP_SD = 0.004; // 40 bp news moves
const NOISE_PER_BLOCK = 0.005; // ≈1,440 noise orders/day
const NOISE_MEAN_USD = 2_000; // ≈$2.9M/day of uninformed flow (1.4x LP capital turnover)
const SNIPER_MAX_USD = 50_000;
const LIQ_USD = 2_000_000; // LP capital per venue

// ------------------------------------------------------------------ rng
let rs = SEED >>> 0 || 1;
const rnd = () => {
  rs ^= rs << 13;
  rs >>>= 0;
  rs ^= rs >>> 17;
  rs ^= rs << 5;
  rs >>>= 0;
  return (rs >>> 0) / 4_294_967_296;
};
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const expo = (mean: number) => -mean * Math.log(rnd() + 1e-12);

// ------------------------------------------------------------------ price path
const sigmaBlock = SIGMA * Math.sqrt(BLOCK_S / (365 * 86_400));
const jumpP = JUMPS_PER_DAY / BLOCKS_PER_DAY;
const P: number[] = [P0];
const mid: number[] = [P0]; // true price observed by the sniper mid-block
for (let b = 1; b <= BLOCKS; b++) {
  const half = P[b - 1]! * Math.exp(sigmaBlock * Math.SQRT1_2 * gauss() + (rnd() < jumpP / 2 ? JUMP_SD * gauss() : 0));
  const end = half * Math.exp(sigmaBlock * Math.SQRT1_2 * gauss() + (rnd() < jumpP / 2 ? JUMP_SD * gauss() : 0));
  mid.push(half);
  P.push(end);
}
// noise flow, identical for every venue: [block, side (+1 buy / -1 sell), usd]
const noise: [number, number, number][] = [];
for (let b = 1; b <= BLOCKS; b++) {
  let k = 0;
  let u = rnd();
  const e = Math.exp(-NOISE_PER_BLOCK);
  let p = e;
  while (u > p) {
    k++;
    u -= p;
    p *= NOISE_PER_BLOCK / k;
  }
  for (let i = 0; i < k; i++) noise.push([b, rnd() < 0.5 ? 1 : -1, expo(NOISE_MEAN_USD)]);
}

interface Result {
  venue: string;
  sniperPnl: number;
  lpPnl: number;
  noiseCostBps: number;
  noiseUsd: number;
  sniperTrades: number;
}

// ------------------------------------------------------------------ A. xy=k AMM
function cpmm(fee: number): Result {
  let x = LIQ_USD / 2 / P0; // base
  let y = LIQ_USD / 2; // quote
  let sniper = 0;
  let trades = 0;
  let noiseCost = 0;
  let noiseUsd = 0;
  let ni = 0;
  for (let b = 1; b <= BLOCKS; b++) {
    // noise traders first (they arrived during the block)
    for (; ni < noise.length && noise[ni]![0] === b; ni++) {
      const [, side, usd] = noise[ni]!;
      const k = x * y;
      if (side > 0) {
        const dy = usd;
        const out = x - k / (y + dy * (1 - fee));
        x -= out;
        y += dy;
        noiseCost += usd - out * P[b]!;
      } else {
        const dx = usd / P[b]!;
        const out = y - k / (x + dx * (1 - fee));
        y -= out;
        x += dx;
        noiseCost += usd - out;
      }
      noiseUsd += usd;
    }
    // the sniper (arbitrageur) moves the pool to the true price minus the fee band
    const pool = y / x;
    const k = x * y;
    const target = P[b]!;
    if (target > pool / (1 - fee)) {
      const yNew = Math.sqrt(k * target * (1 - fee));
      const xNew = k / yNew;
      const dy = (yNew - y) / (1 - fee);
      const gain = (x - xNew) * target - dy;
      if (gain > 0) {
        sniper += gain;
        trades++;
        y += dy;
        x = xNew;
      }
    } else if (target < pool * (1 - fee)) {
      const xNew = Math.sqrt((k / target) * (1 - fee));
      const yNew = k / xNew;
      const dx = (xNew - x) / (1 - fee);
      const gain = y - yNew - dx * target;
      if (gain > 0) {
        sniper += gain;
        trades++;
        x += dx;
        y = yNew;
      }
    }
  }
  const lp = x * P[BLOCKS]! + y - (LIQ_USD / 2 / P0) * P[BLOCKS]! - LIQ_USD / 2; // vs holding
  return { venue: `xy=k AMM (fee ${fee * 1e4} bp)`, sniperPnl: sniper, lpPnl: lp, noiseCostBps: (noiseCost / noiseUsd) * 1e4, noiseUsd, sniperTrades: trades };
}

// ------------------------------------------------------------------ B. push-oracle AMM
function oracleAmm(spread: number, deviation: number, heartbeatBlocks: number): Result {
  let oracle = P0;
  let lastUpdate = 0;
  let sniper = 0;
  let trades = 0;
  let lp = 0;
  let noiseCost = 0;
  let noiseUsd = 0;
  let ni = 0;
  const depth = LIQ_USD * 0.025; // USD quoted per side, replenished at each oracle update (same risk budget)
  let askLeft = depth;
  let bidLeft = depth;
  for (let b = 1; b <= BLOCKS; b++) {
    // the sniper sees the true price mid-block, before the oracle moves
    const t = mid[b]!;
    const ask = oracle * (1 + spread);
    const bid = oracle * (1 - spread);
    if (t > ask && askLeft > 0) {
      const usd = Math.min(SNIPER_MAX_USD, askLeft);
      const gain = (usd / ask) * (P[b]! - ask);
      sniper += gain;
      lp -= gain;
      askLeft -= usd;
      trades++;
    } else if (t < bid && bidLeft > 0) {
      const usd = Math.min(SNIPER_MAX_USD, bidLeft);
      const gain = (usd / bid) * (bid - P[b]!);
      sniper += gain;
      lp -= gain;
      bidLeft -= usd;
      trades++;
    }
    for (; ni < noise.length && noise[ni]![0] === b; ni++) {
      const [, side, usd] = noise[ni]!;
      const px = side > 0 ? ask : bid;
      const cost = side > 0 ? (usd / px) * (px - P[b]!) : (usd / P[b]!) * (P[b]! - px) * (P[b]! / px);
      noiseCost += cost;
      lp += cost;
      noiseUsd += usd;
    }
    // Chainlink-style update after the block
    if (Math.abs(P[b]! / oracle - 1) > deviation || b - lastUpdate >= heartbeatBlocks) {
      oracle = P[b]!;
      lastUpdate = b;
      askLeft = depth;
      bidLeft = depth;
    }
  }
  return { venue: `push-oracle AMM (±${spread * 1e4} bp, ${deviation * 1e4} bp deviation)`, sniperPnl: sniper, lpPnl: lp, noiseCostBps: (noiseCost / noiseUsd) * 1e4, noiseUsd, sniperTrades: trades };
}

// ------------------------------------------------------------------ C. CLOB with makers
function clob(halfSpread: number, raceWin: number): Result {
  let sniper = 0;
  let trades = 0;
  let mm = 0;
  let noiseCost = 0;
  let noiseUsd = 0;
  let ni = 0;
  const size = 25_000; // USD quoted per side at the touch
  for (let b = 1; b <= BLOCKS; b++) {
    const m = P[b - 1]!; // makers' quotes reflect the previous block
    const ask = m * (1 + halfSpread);
    const bid = m * (1 - halfSpread);
    const t = mid[b]!;
    if ((t > ask || t < bid) && rnd() < raceWin) {
      const gain = t > ask ? (size / ask) * (P[b]! - ask) : (size / bid) * (bid - P[b]!);
      sniper += gain;
      mm -= gain;
      trades++;
    }
    for (; ni < noise.length && noise[ni]![0] === b; ni++) {
      const [, side, usd] = noise[ni]!;
      const px = side > 0 ? ask : bid;
      const cost = (usd / px) * (side > 0 ? px - P[b]! : P[b]! - px);
      noiseCost += cost;
      mm += cost;
      noiseUsd += usd;
    }
  }
  return { venue: `CLOB + makers (±${halfSpread * 1e4} bp, sniper wins ${raceWin * 100}% of races)`, sniperPnl: sniper, lpPnl: mm, noiseCostBps: (noiseCost / noiseUsd) * 1e4, noiseUsd, sniperTrades: trades };
}

// ------------------------------------------------------------------ D. Unison (engine clearing)
function unison(vaultHalfSpreadBps: number, feeBps: number, staleRef = false): Result {
  const TICK = 0.01;
  const toTick = (p: number) => Math.round(p / TICK);
  let sniper = 0;
  let trades = 0;
  let vault = 0;
  let noiseCost = 0;
  let noiseUsd = 0;
  let ni = 0;
  const depthPerTickUsd = LIQ_USD * 0.004; // vault quotes 0.4% of NAV per tick, 10 ticks per side
  const WIDTH = 10;
  for (let b = 1; b <= BLOCKS; b++) {
    const refPrev = P[b - 1]!; // the last published reference (what the sniper can see on-chain)
    // the rule: the reference is published AFTER batch b closed. `staleRef` breaks it on purpose.
    const ref = staleRef ? P[b - 1]! : P[b]!;
    const refTick = toTick(ref);
    const hw = Math.max(1, Math.round(refTick * 0.01));
    const lo = refTick - hw;
    const hi = refTick + hw;
    const n = hi - lo + 1;
    // participants per tick: [kind, qty(base, 1e6 fixed point)]
    type Part = { who: "vault" | "sniper" | "noise"; side: 1 | -1; tick: number; q: bigint; usd?: number };
    const parts: Part[] = [];
    const half = Math.max(1, Math.round((refTick * vaultHalfSpreadBps) / 1e4));
    const q = BigInt(Math.round((depthPerTickUsd / ref) * 1e6));
    for (let i = 0; i < WIDTH; i++) {
      parts.push({ who: "vault", side: 1, tick: refTick - half - i, q });
      parts.push({ who: "vault", side: -1, tick: refTick + half + i, q });
    }
    // the sniper trades on its mid-block view vs the stale on-chain reference, limit = its fair value
    const t = mid[b]!;
    if (Math.abs(t / refPrev - 1) > (vaultHalfSpreadBps + feeBps) / 1e4) {
      const side = t > refPrev ? 1 : -1;
      parts.push({ who: "sniper", side, tick: toTick(t), q: BigInt(Math.round((SNIPER_MAX_USD / t) * 1e6)) });
    }
    for (; ni < noise.length && noise[ni]![0] === b; ni++) {
      const [, side, usd] = noise[ni]!;
      parts.push({ who: "noise", side: side as 1 | -1, tick: side > 0 ? hi : lo, q: BigInt(Math.round((usd / refPrev) * 1e6)), usd });
    }
    const bids = new Array<bigint>(n).fill(0n);
    const asks = new Array<bigint>(n).fill(0n);
    let bidAbove = 0n;
    let askBelow = 0n;
    for (const p of parts) {
      if (p.side > 0) {
        if (p.tick > hi) bidAbove += p.q;
        else if (p.tick >= lo) bids[p.tick - lo]! += p.q;
      } else {
        if (p.tick < lo) askBelow += p.q;
        else if (p.tick <= hi) asks[p.tick - lo]! += p.q;
      }
    }
    const r = compute({ lo: BigInt(lo), hi: BigInt(hi), refTick: BigInt(refTick), bidAbove, askBelow, bids, asks });
    if (!r.traded) continue;
    const px = Number(r.tick) * TICK;
    const fills = allocate(parts, r, lo, hi, n);
    for (let i = 0; i < parts.length; i++) {
      const f = Number(fills[i]!) / 1e6;
      if (f === 0) continue;
      const p = parts[i]!;
      const fee = (f * px * feeBps) / 1e4;
      // P&L marked to the true price at the auction
      const truth = P[b]!;
      const pnl = p.side > 0 ? f * (truth - px) : f * (px - truth);
      if (p.who === "vault") vault += pnl;
      else if (p.who === "sniper") {
        sniper += pnl - fee;
        trades++;
      } else {
        noiseCost += -pnl + fee;
        noiseUsd += f * px;
      }
    }
  }
  const name = staleRef
    ? `Unison with a STALE reference (rule broken on purpose)`
    : `Unison FBA (vault ±${vaultHalfSpreadBps} bp, fee ${feeBps} bp)`;
  return { venue: name, sniperPnl: sniper, lpPnl: vault, noiseCostBps: noiseUsd ? (noiseCost / noiseUsd) * 1e4 : 0, noiseUsd, sniperTrades: trades };
}

/** Per-participant fills exactly like the on-chain APPLY phase (full levels, exact apportionment at the margin). */
function allocate(
  parts: { side: 1 | -1; tick: number; q: bigint }[],
  r: ReturnType<typeof compute>,
  lo: number,
  hi: number,
  n: number,
): bigint[] {
  const out = new Array<bigint>(parts.length).fill(0n);
  for (const side of [1, -1] as const) {
    const marg = Number(side > 0 ? r.bidMarginal : r.askMarginal);
    const need = side > 0 ? r.bidMarginalFill : r.askMarginalFill;
    // marginal tick (0 = the ABOVE / BELOW class)
    const tm = marg === 0 ? null : side > 0 ? hi - (marg - 1) : lo + (marg - 1);
    const inClass = (t: number) => (tm === null ? (side > 0 ? t > hi : t < lo) : t === tm);
    const better = (t: number) =>
      tm === null ? false : side > 0 ? t > tm : t < tm; // incl. outside-band classes
    const margIdx: number[] = [];
    parts.forEach((p, i) => {
      if (p.side !== side) return;
      if (better(p.tick)) out[i] = p.q;
      else if (inClass(p.tick)) margIdx.push(i);
    });
    const shares = apportionAll(need, margIdx.map((i) => parts[i]!.q));
    margIdx.forEach((i, k) => (out[i] = shares[k]!));
    void n;
  }
  return out;
}

// ------------------------------------------------------------------ run
const scale = BLOCKS_PER_DAY / BLOCKS;
const results = [
  cpmm(0.003),
  oracleAmm(0.001, 0.005, 12_000),
  clob(0.0002, 0.5),
  unison(10, 3),
  unison(2, 1), // same 2 bp half-spread as the CLOB makers
  unison(10, 3, true),
];
const fmt = (x: number) => (x >= 0 ? " " : "-") + "$" + Math.abs(Math.round(x * scale)).toLocaleString("en-US");
console.log(`\n${BLOCKS.toLocaleString()} blocks (${(BLOCKS * BLOCK_S / 3600).toFixed(1)} h), σ=${SIGMA * 100}%/yr, ${JUMPS_PER_DAY} news jumps/day of ${JUMP_SD * 1e4} bp, LP capital $${LIQ_USD.toLocaleString()}\n`);
console.log("| Venue | Sniper P&L / day | LP or maker P&L / day | Noise trader cost | Sniper trades / day |");
console.log("|---|---:|---:|---:|---:|");
for (const r of results) {
  console.log(
    `| ${r.venue} | ${fmt(r.sniperPnl)} | ${fmt(r.lpPnl)} | ${r.noiseCostBps.toFixed(1)} bp | ${Math.round(r.sniperTrades * scale).toLocaleString()} |`,
  );
}
