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

/** The latest price: a flat bead in blued steel, haloed in the card, never a glossy marble. */
function Ball({ x, y, r = 8 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r * 0.8} fill="var(--accent)" stroke="var(--bg-raised)" strokeWidth={2} />;
}

/** A round step for an axis: 1, 2 or 5 × 10^k, giving about `target` divisions of `range`. */
export function niceStep(range: number, target: number) {
  const raw = Math.max(range, 1e-9) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** The name of the price the band is centred on: the reference, or, while its market is closed, the last close. */
export const refName = (m: MarketState) => (m.regime.name === "DISCOVERY" ? "Last close" : "Reference");

/**
 * The prices the batch chart shows: centred on where trading is (the last trade), since while its market is closed
 * the reference stays at the close and trading can be far from it. The centre moves in steps, so the window holds
 * still between auctions. Shared with the chart's key, which names only what is on the chart.
 */
export function crossWindow(m: MarketState) {
  const span = Math.max(12, Math.min(48, Math.round((m.hi - m.lo) / 2)));
  const anchor = m.last?.tick ?? m.refTick;
  const hop = Math.max(2, Math.round(span / 3));
  const centre = Math.round(anchor / hop) * hop;
  return { lo: centre - span, hi: centre + span };
}

export function CrossChart({
  m,
  fmt,
  cross = null,
  w = 900,
  h = 420,
}: { m: MarketState; fmt: (tick: number) => string; cross?: { tick: number; volume: number } | null } & ChartSize) {
  const W = Math.max(280, w);
  const H = Math.max(200, h);
  const { lo, hi } = crossWindow(m);
  const { ticks, demand, supply } = useMemo(() => curves([...m.book, ...m.vault], lo, hi), [m.book, m.vault, lo, hi]);
  // Scaled to the meeting point, not to the deep walls at the window's edges (the vault's ladder, resting orders):
  // the cross is what this view is for. Deeper levels run off the top; the scale says how far up it goes.
  const peak = Math.max(1, ...demand, ...supply);
  const focus = cross ? Math.min(peak, Math.max(cross.volume * 3.5, peak * 0.12, 1)) : peak;
  const qStep = niceStep(focus * 1.08, 3);
  const maxQ = Math.ceil((focus * 1.08) / qStep) * qStep;
  const tStep = Math.max(1, Math.round(niceStep(hi - lo, W < 560 ? 3 : 5)));
  const axis: number[] = [];
  for (let t = Math.ceil(lo / tStep) * tStep; t <= hi; t += tStep) axis.push(t);
  const P = { l: 16, r: 52, t: 46, b: 44 };
  const x = (t: number) => P.l + ((t - lo + 0.5) / (hi - lo + 1)) * (W - P.l - P.r);
  const y = (q: number) => H - P.b - (q / maxQ) * (H - P.t - P.b);
  const step = (vals: number[]) =>
    vals
      .map(
        (v, i) =>
          `${i === 0 ? `M${x(ticks[i]! - 0.5).toFixed(1)},${y(v).toFixed(1)}` : `V${y(v).toFixed(1)}`}H${x(ticks[i]! + 0.5).toFixed(1)}`,
      )
      .join("");
  const mine = m.book.filter((o) => o.owner === "you" && o.tick >= lo && o.tick <= hi);
  const last = m.last && m.last.tick >= lo && m.last.tick <= hi ? m.last : null;
  const crossOn = cross && cross.tick >= lo && cross.tick <= hi ? cross : null;
  const unit = m.spec.ticker;
  const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const bandLo = Math.max(lo, m.lo);
  const bandHi = Math.min(hi, m.hi);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      role="img"
      aria-label={`Batch forming: ${m.book.length} resting and new orders${crossOn ? `; it would clear ${qty(crossOn.volume)} ${unit} at ${fmt(crossOn.tick)}` : ""}${last ? `; last trade ${fmt(last.tick)}` : ""}.`}
    >
      <defs>
        <clipPath id="cross-plot">
          <rect x={P.l} y={P.t} width={W - P.l - P.r} height={H - P.t - P.b + 1} />
        </clipPath>
      </defs>
      {/* Outside the band: no fills there this batch */}
      {m.lo > lo ? (
        <rect x={x(lo - 0.5)} y={P.t} width={x(m.lo - 0.5) - x(lo - 0.5)} height={H - P.t - P.b} fill="url(#hatch)" />
      ) : null}
      {m.hi < hi ? (
        <rect x={x(m.hi + 0.5)} y={P.t} width={x(hi + 0.5) - x(m.hi + 0.5)} height={H - P.t - P.b} fill="url(#hatch)" />
      ) : null}
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="2" />
        </pattern>
      </defs>
      {Array.from({ length: Math.round(maxQ / qStep) }, (_, i) => (i + 1) * qStep).map((q) => (
        <g key={q}>
          <line x1={P.l} x2={W - P.r} y1={y(q)} y2={y(q)} stroke="var(--line)" />
          <text
            x={W - P.r + 8}
            y={y(q)}
            dominantBaseline="middle"
            className="figures"
            fill="var(--ink-3)"
            style={{ fontSize: 11 }}
          >
            {q.toLocaleString("en-US", { maximumFractionDigits: qStep < 1 ? 1 : 0 })}
          </text>
        </g>
      ))}
      <text x={W - P.r + 8} y={P.t - 18} fill="var(--ink-3)" style={{ fontSize: 11 }}>
        {unit}
      </text>
      <g clipPath="url(#cross-plot)">
        <path d={`${step(demand)}V${y(0)}H${x(lo - 0.5)}Z`} fill="var(--buy-soft)" />
        <path d={`${step(supply)}V${y(0)}H${x(lo - 0.5)}Z`} fill="var(--sell-soft)" />
        <path d={step(demand)} fill="none" stroke="var(--buy)" strokeWidth="1.8" />
        <path d={step(supply)} fill="none" stroke="var(--sell)" strokeWidth="1.8" />
      </g>
      <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
      {axis.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(0) + 5} stroke="var(--line-strong)" />
          <text
            x={x(t)}
            y={H - 16}
            textAnchor={x(t) < P.l + 30 ? "start" : x(t) > W - P.r - 30 ? "end" : "middle"}
            className="figures"
            fill="var(--ink-3)"
            style={{ fontSize: 12 }}
          >
            {fmt(t)}
          </text>
        </g>
      ))}
      {/* the price the band is centred on: a pointer under the axis, or a note at the edge when it is off the chart */}
      {m.refTick >= lo && m.refTick <= hi ? (
        <path d={`M${x(m.refTick)},${y(0) + 7} l-5,9 h10 z`} fill="var(--ink-2)" />
      ) : (
        <text
          x={m.refTick < lo ? P.l + 2 : W - P.r - 2}
          y={y(0) - 10}
          textAnchor={m.refTick < lo ? "start" : "end"}
          className="figures"
          fill="var(--ink-3)"
          stroke="var(--bg-raised)"
          strokeWidth={4}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ fontSize: 12 }}
        >
          {m.refTick < lo
            ? `← ${refName(m).toLowerCase()} ${fmt(m.refTick)}`
            : `${refName(m).toLowerCase()} ${fmt(m.refTick)} →`}
        </text>
      )}
      {mine.map((o) => (
        <g key={o.id}>
          <line x1={x(o.tick)} x2={x(o.tick)} y1={P.t} y2={y(0)} stroke="var(--accent)" strokeDasharray="3 4" />
          <text x={x(o.tick) + 6} y={P.t + 14} fill="var(--accent)" style={{ fontSize: 12, fontWeight: 600 }}>
            You
          </text>
        </g>
      ))}
      {/* the last auction's price: a quiet ring on the price axis, named in the key, never a label on the data */}
      {last ? <circle cx={x(last.tick)} cy={y(0)} r="4.5" fill="var(--bg-raised)" stroke="var(--ink-2)" strokeWidth="1.5" /> : null}
      {/* where this batch would clear now: a hairline from the rail above the plot to the meeting point, labelled in
          the rail, so no annotation ever sits on the curves */}
      {crossOn ? (
        <g>
          <line x1={x(crossOn.tick)} x2={x(crossOn.tick)} y1={P.t - 8} y2={y(0)} stroke="var(--ink-2)" strokeDasharray="2 3" />
          <circle cx={x(crossOn.tick)} cy={y(Math.min(maxQ, crossOn.volume))} r="5" fill="var(--accent)" />
          <text
            x={Math.min(W - P.r - 104, Math.max(P.l + 104, x(crossOn.tick)))}
            y={P.t - 16}
            textAnchor="middle"
            className="figures"
            fill="var(--ink)"
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            Clears now {fmt(crossOn.tick)} · {qty(crossOn.volume)} {unit}
          </text>
        </g>
      ) : null}
      <title>{`Band ${fmt(bandLo)} to ${fmt(bandHi)}`}</title>
    </svg>
  );
}

export function PrintsChart({
  m,
  fmt,
  w = 900,
  h = 420,
}: { m: MarketState; fmt: (tick: number) => string } & ChartSize) {
  const W = Math.max(280, w);
  const H = Math.max(200, h);
  const prints = m.prints.slice(-240);
  if (prints.length < 2)
    return <div className="grid h-full place-items-center text-sm text-ink-3">Waiting for prints…</div>;
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
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      role="img"
      aria-label={`Last ${prints.length} prints; latest ${fmt(last.tick)}.`}
    >
      {grid.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text
            x={W - P.r + 8}
            y={y(t)}
            dominantBaseline="middle"
            className="tnum"
            fill="var(--ink-3)"
            style={{ fontSize: 12 }}
          >
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

export function DepthLadder({
  m,
  fmt,
  onPick,
}: {
  m: MarketState;
  fmt: (tick: number) => string;
  onPick?: (tick: number) => void;
}) {
  const levels = 9;
  const byTick = new Map<number, { buy: number; sell: number; mine: boolean }>();
  // the book and the vault's quotes, level by level
  for (const o of [...m.book, ...m.vault.map((v) => ({ ...v, owner: "vault" as const }))]) {
    const e = byTick.get(o.tick) ?? { buy: 0, sell: 0, mine: false };
    if (o.side === "buy") e.buy += o.qty;
    else e.sell += o.qty;
    if (o.owner === "you") e.mine = true;
    byTick.set(o.tick, e);
  }
  const asks = [...byTick.entries()]
    .filter(([, v]) => v.sell > 0)
    .sort((a, b) => a[0] - b[0])
    .slice(0, levels)
    .reverse();
  const bids = [...byTick.entries()]
    .filter(([, v]) => v.buy > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, levels);
  const max = Math.max(1, ...asks.map(([, v]) => v.sell), ...bids.map(([, v]) => v.buy));
  const Row = ({ tick, q, side, mine }: { tick: number; q: number; side: "buy" | "sell"; mine: boolean }) => (
    <button
      type="button"
      onClick={() => onPick?.(tick)}
      className="group relative grid h-8 w-full grid-cols-[1fr_auto] items-center px-4 text-left text-sm hover-fine:bg-ink/[0.04]"
      aria-label={`${side === "buy" ? "Bid" : "Ask"} ${q.toFixed(2)} at ${fmt(tick)}`}
    >
      <span
        className={`absolute inset-y-1 right-0 rounded-l-sm ${side === "buy" ? "bg-buy-soft" : "bg-sell-soft"}`}
        style={{ width: `${(q / max) * 70}%` }}
      />
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
