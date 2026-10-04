"use client";

import { useMemo } from "react";
import type { MarketState } from "@/lib/demo/engine";
import { curves } from "@/lib/sim/batch";

/**
 * The terminal's three views of one market. Cross: the batch now forming, demand against supply, the band shaded
 * outside, the last uniform price as the ball. Prints: every batch print against the reference. Depth: the resting
 * ladder around the reference with your orders marked. Charts draw at their measured size, so type stays type-size
 * on a phone instead of shrinking with a fixed drawing.
 */
export interface ChartSize {
  w?: number;
  h?: number;
}

function Ball({ x, y, r = 8 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <defs>
        <radialGradient id="termBall" cx="0.38" cy="0.34" r="0.72">
          <stop offset="0" style={{ stopColor: "var(--ball-1)" }} />
          <stop offset="0.4" style={{ stopColor: "var(--ball-2)" }} />
          <stop offset="0.82" style={{ stopColor: "var(--ball-3)" }} />
          <stop offset="1" style={{ stopColor: "var(--ball-4)" }} />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={r} fill="url(#termBall)" />
    </g>
  );
}

/** The simulation's vault quotes; live mode shows only real, on-chain liquidity. */
export function simulatedVault(refTick: number) {
  const v = [];
  for (let k = 0; k < 6; k++) {
    v.push({ id: -1 - k, side: "buy" as const, tick: refTick - 6 - k * 2, qty: 3 + k });
    v.push({ id: -100 - k, side: "sell" as const, tick: refTick + 6 + k * 2, qty: 3 + k });
  }
  return v;
}

const axisTicks = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + Math.round(((hi - lo) * i) / (n - 1)));

export function CrossChart({ m, fmt, live = false, w = 900, h = 420 }: { m: MarketState; fmt: (tick: number) => string; live?: boolean } & ChartSize) {
  const W = Math.max(280, w);
  const H = Math.max(200, h);
  const span = Math.max(12, Math.min(48, Math.round((m.hi - m.lo) / 2)));
  const lo = m.refTick - span;
  const hi = m.refTick + span;
  const vault = useMemo(() => (live ? [] : simulatedVault(m.refTick)), [m.refTick, live]);
  const { ticks, demand, supply } = useMemo(() => curves([...m.book, ...vault], lo, hi), [m.book, vault, lo, hi]);
  const maxQ = Math.max(10, ...demand, ...supply) * 1.1;
  const P = { l: 16, r: 52, t: 24, b: 44 };
  const x = (t: number) => P.l + ((t - lo + 0.5) / (hi - lo + 1)) * (W - P.l - P.r);
  const y = (q: number) => H - P.b - (q / maxQ) * (H - P.t - P.b);
  const step = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? `M${x(ticks[i]! - 0.5).toFixed(1)},${y(v).toFixed(1)}` : `V${y(v).toFixed(1)}`}H${x(ticks[i]! + 0.5).toFixed(1)}`).join("");
  const mine = m.book.filter((o) => o.owner === "you" && o.tick >= lo && o.tick <= hi);
  const last = m.last && m.last.tick >= lo && m.last.tick <= hi ? m.last : null;
  const lastQ = last ? Math.min(maxQ * 0.98, last.volume) : 0;
  const bandLo = Math.max(lo, m.lo);
  const bandHi = Math.min(hi, m.hi);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={`Batch forming: ${m.book.length} resting and new orders${last ? `; last price ${fmt(last.tick)}` : ""}.`}>
      {/* Outside the band: no fills there this batch */}
      {m.lo > lo ? <rect x={x(lo - 0.5)} y={P.t} width={x(m.lo - 0.5) - x(lo - 0.5)} height={H - P.t - P.b} fill="url(#hatch)" /> : null}
      {m.hi < hi ? <rect x={x(m.hi + 0.5)} y={P.t} width={x(hi + 0.5) - x(m.hi + 0.5)} height={H - P.t - P.b} fill="url(#hatch)" /> : null}
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="2" />
        </pattern>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <g key={f}>
          <line x1={P.l} x2={W - P.r} y1={y(maxQ * f)} y2={y(maxQ * f)} stroke="var(--line)" />
          <text x={W - P.r + 8} y={y(maxQ * f)} dominantBaseline="middle" className="tnum" fill="var(--ink-3)" style={{ fontSize: 11 }}>
            {(maxQ * f).toFixed(maxQ * f < 10 ? 1 : 0)}
          </text>
        </g>
      ))}
      <text x={W - P.r + 8} y={P.t - 8} fill="var(--ink-3)" style={{ fontSize: 11 }}>
        shares
      </text>
      <path d={`${step(demand)}V${y(0)}H${x(lo - 0.5)}Z`} fill="var(--buy-soft)" />
      <path d={`${step(supply)}V${y(0)}H${x(lo - 0.5)}Z`} fill="var(--sell-soft)" />
      <path d={step(demand)} fill="none" stroke="var(--buy)" strokeWidth="1.8" />
      <path d={step(supply)} fill="none" stroke="var(--sell)" strokeWidth="1.8" />
      <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
      {axisTicks(lo, hi, W < 560 ? 3 : 5).map((t, i, a) => (
        <text key={t} x={x(t)} y={H - 16} textAnchor={i === 0 ? "start" : i === a.length - 1 ? "end" : "middle"} className="tnum" fill="var(--ink-3)" style={{ fontSize: 12 }}>
          {fmt(t)}
        </text>
      ))}
      <path d={`M${x(m.refTick)},${y(0) + 4} l-5,9 h10 z`} fill="var(--ink-2)" />
      {mine.map((o) => (
        <g key={o.id}>
          <line x1={x(o.tick)} x2={x(o.tick)} y1={P.t} y2={y(0)} stroke="var(--accent)" strokeDasharray="3 4" />
          <text x={x(o.tick) + 6} y={P.t + 14} fill="var(--accent)" style={{ fontSize: 12, fontWeight: 600 }}>
            You
          </text>
        </g>
      ))}
      {last ? (
        <g>
          <line x1={x(last.tick)} x2={x(last.tick)} y1={y(0)} y2={y(lastQ)} stroke="var(--ink)" strokeDasharray="2 4" />
          <Ball x={x(last.tick)} y={y(lastQ)} />
        </g>
      ) : null}
      <title>{`Band ${fmt(bandLo)} to ${fmt(bandHi)}`}</title>
    </svg>
  );
}

export function PrintsChart({ m, fmt, w = 900, h = 420 }: { m: MarketState; fmt: (tick: number) => string } & ChartSize) {
  const W = Math.max(280, w);
  const H = Math.max(200, h);
  const prints = m.prints.slice(-240);
  if (prints.length < 2) return <div className="grid h-full place-items-center text-sm text-ink-3">Waiting for prints…</div>;
  const ticks = prints.flatMap((p) => [p.tick, p.refTick]);
  const min = Math.min(...ticks) - 2;
  const max = Math.max(...ticks) + 2;
  const P = { l: 12, r: 64, t: 20, b: 28 };
  const x = (i: number) => P.l + (i / (prints.length - 1)) * (W - P.l - P.r);
  const y = (t: number) => P.t + (1 - (t - min) / (max - min)) * (H - P.t - P.b);
  const line = prints.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.tick).toFixed(1)}`).join("");
  const ref = prints.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.refTick).toFixed(1)}`).join("");
  const last = prints.at(-1)!;
  const grid = [0, 0.33, 0.66, 1].map((f) => Math.round(min + (max - min) * f));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={`Last ${prints.length} prints; latest ${fmt(last.tick)}.`}>
      {grid.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={W - P.r + 8} y={y(t)} dominantBaseline="middle" className="tnum" fill="var(--ink-3)" style={{ fontSize: 12 }}>
            {fmt(t)}
          </text>
        </g>
      ))}
      <path d={ref} fill="none" stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 5" />
      <path d={line} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <Ball x={x(prints.length - 1)} y={y(last.tick)} r={6} />
    </svg>
  );
}

export function DepthLadder({ m, fmt, onPick, live = false }: { m: MarketState; fmt: (tick: number) => string; onPick?: (tick: number) => void; live?: boolean }) {
  const levels = 9;
  const byTick = new Map<number, { buy: number; sell: number; mine: boolean }>();
  for (const o of m.book) {
    const e = byTick.get(o.tick) ?? { buy: 0, sell: 0, mine: false };
    if (o.side === "buy") e.buy += o.qty;
    else e.sell += o.qty;
    if (o.owner === "you") e.mine = true;
    byTick.set(o.tick, e);
  }
  for (let k = 0; k < (live ? 0 : 6); k++) {
    const b = byTick.get(m.refTick - 6 - k * 2) ?? { buy: 0, sell: 0, mine: false };
    b.buy += 3 + k;
    byTick.set(m.refTick - 6 - k * 2, b);
    const a = byTick.get(m.refTick + 6 + k * 2) ?? { buy: 0, sell: 0, mine: false };
    a.sell += 3 + k;
    byTick.set(m.refTick + 6 + k * 2, a);
  }
  const asks = [...byTick.entries()].filter(([, v]) => v.sell > 0).sort((a, b) => a[0] - b[0]).slice(0, levels).reverse();
  const bids = [...byTick.entries()].filter(([, v]) => v.buy > 0).sort((a, b) => b[0] - a[0]).slice(0, levels);
  const max = Math.max(1, ...asks.map(([, v]) => v.sell), ...bids.map(([, v]) => v.buy));
  const Row = ({ tick, q, side, mine }: { tick: number; q: number; side: "buy" | "sell"; mine: boolean }) => (
    <button
      type="button"
      onClick={() => onPick?.(tick)}
      className="group relative grid h-8 w-full grid-cols-[1fr_auto] items-center px-4 text-left text-sm hover-fine:bg-ink/[0.04]"
      aria-label={`${side === "buy" ? "Bid" : "Ask"} ${q.toFixed(2)} at ${fmt(tick)}`}
    >
      <span className={`absolute inset-y-1 right-0 rounded-l-sm ${side === "buy" ? "bg-buy-soft" : "bg-sell-soft"}`} style={{ width: `${(q / max) * 70}%` }} />
      <span className={`tnum relative font-medium ${side === "buy" ? "text-buy" : "text-sell"}`}>
        {fmt(tick)}
        {mine ? <span className="ml-2 rounded bg-accent-soft px-1 text-[11px] text-accent">you</span> : null}
      </span>
      <span className="tnum relative text-ink-2">{q.toFixed(2)}</span>
    </button>
  );
  return (
    <div className="flex h-full flex-col justify-center py-2">
      {asks.map(([t, v]) => (
        <Row key={`a${t}`} tick={t} q={v.sell} side="sell" mine={v.mine} />
      ))}
      <div className="my-1 flex items-center gap-3 px-4 text-xs text-ink-3">
        <span className="h-px flex-1 bg-line-strong" />
        Reference {fmt(m.refTick)}
        <span className="h-px flex-1 bg-line-strong" />
      </div>
      {bids.map(([t, v]) => (
        <Row key={`b${t}`} tick={t} q={v.buy} side="buy" mine={v.mine} />
      ))}
    </div>
  );
}
