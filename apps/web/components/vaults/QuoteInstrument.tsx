"use client";

import { useId, useState } from "react";
import { priceFormat, type MarketSpec } from "@/lib/content/markets";
import { statusOfRegime, vaultCurve, type RefStatus } from "@/lib/unison/vaultCurve";
import { useSize } from "@/components/trade/useSize";

/**
 * What a market's vault quotes, drawn from the contract's own formula (LiquidityVault.curve, ported integer for
 * integer): bids and asks a half-spread either side of the reference, the half-spread widening with the regime,
 * both sides leaning to rebalance inventory. Change the regime or the inventory and the quotes move where the
 * vault would move them. The scale is fixed at the widest case, so widening reads as widening.
 */
const E18 = 10n ** 18n;
const REGIMES: [RefStatus, string][] = [
  ["OPEN", "Open"],
  ["EXTENDED", "Extended"],
  ["CLOSED", "Discovery"],
  ["HALTED", "Halted"],
];
const EASE = "transform 460ms cubic-bezier(0.23, 1, 0.32, 1)";

export function QuoteInstrument({
  spec,
  refTick,
  regime,
  initialWeight = 50,
  nav = 2_000_000,
  compact = false,
}: {
  spec: MarketSpec;
  refTick: number;
  regime: string;
  /** base share of NAV, % */
  initialWeight?: number;
  /** NAV in AUSD the depth is drawn for */
  nav?: number;
  compact?: boolean;
}) {
  const p = spec.vault!;
  const [status, setStatus] = useState<RefStatus>(() => statusOfRegime(regime));
  const [weight, setWeight] = useState(() => Math.round(initialWeight));
  const [ref, size] = useSize<HTMLDivElement>();
  const sliderId = useId();
  const { unit, decimals, fmt } = priceFormat(spec);

  const refPrice = BigInt(refTick) * spec.tickSize;
  const navQ = BigInt(Math.round(nav * 1e6));
  const baseVal = (navQ * BigInt(weight)) / 100n;
  const q = vaultCurve(p, { refPrice, refTick, status, baseBalance: refPrice > 0n ? (baseVal * E18) / refPrice : 0n, quoteBalance: navQ - baseVal, baseUnit: E18 });

  const closedHalf = Math.max(1, Math.floor((refTick * p.spreadBps * p.closedMult) / 10_000));
  const R = closedHalf + p.widthTicks + p.maxSkewTicks + 3;
  const W = Math.max(260, size.width);
  const H = compact ? 92 : 200;
  const pad = 12;
  const tickW = (W - 2 * pad) / (2 * R + 1);
  const x = (t: number) => pad + (t - (refTick - R)) * tickW;
  const base = H - (compact ? 14 : 44);
  const barH = compact ? 46 : 96;
  const blockW = p.widthTicks * tickW;
  const halted = status === "HALTED" || q.bidTicks + q.askTicks === 0;
  const bidStart = x(q.bidTop - p.widthTicks + 1);
  const askStart = x(q.askBottom);
  const spreadTicks = q.askBottom - q.bidTop;
  const bp = refTick > 0 ? (q.half / refTick) * 10_000 : 0;
  const perTick = Number(q.perTick) / 1e18;

  const block = (side: "buy" | "sell") => (
    <g style={{ transform: `translateX(${side === "buy" ? bidStart : askStart}px)`, transition: EASE, opacity: halted ? 0 : 1 }} className="motion-reduce:transition-none">
      {Array.from({ length: p.widthTicks }, (_, i) => (
        <rect key={i} x={i * tickW + 0.6} y={base - barH} width={Math.max(1, tickW - 1.2)} height={barH} rx={Math.min(2, tickW / 4)} fill={`var(--${side}-soft)`} />
      ))}
      <rect x={0} y={base - barH} width={blockW} height={1.6} fill={`var(--${side})`} />
    </g>
  );

  return (
    <div>
      <div ref={ref} className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }} role="img" aria-label={halted ? "No vault quotes while halted." : `Vault quotes: bids from ${fmt(q.bidTop - p.widthTicks + 1)} to ${fmt(q.bidTop)}, asks from ${fmt(q.askBottom)} to ${fmt(q.askBottom + p.widthTicks - 1)}, around a reference of ${fmt(refTick)}.`}>
          <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--line-strong)" />
          {block("buy")}
          {block("sell")}
          {/* the spread, as a dimension line between best bid and best ask */}
          {!halted && !compact ? (
            <g style={{ transform: `translateX(${x(q.bidTop) + tickW}px)`, transition: EASE }} className="motion-reduce:transition-none">
              <g style={{ transform: `scaleX(${Math.max(0.001, (spreadTicks - 1) * tickW) / 100})`, transformOrigin: "0 0", transition: EASE }} className="motion-reduce:transition-none">
                <line x1={0} x2={100} y1={base - barH - 18} y2={base - barH - 18} stroke="var(--ink-3)" vectorEffect="non-scaling-stroke" />
              </g>
            </g>
          ) : null}
          {/* the spread's value sits beside the reference, never on it: the hand passes through the middle of the gap */}
          {!halted && !compact ? (
            <text x={x(refTick) + tickW / 2 + 8} y={base - barH - 23} className="tnum" fill="var(--ink-3)" style={{ fontSize: 11.5 }}>
              spread {fmt(spreadTicks)}
            </text>
          ) : null}
          {/* the reference: the hand everything is priced against */}
          <line x1={x(refTick) + tickW / 2} x2={x(refTick) + tickW / 2} y1={compact ? 6 : 22} y2={base} stroke="var(--champagne)" strokeWidth="1.5" />
          <circle cx={x(refTick) + tickW / 2} cy={compact ? 6 : 22} r={compact ? 3 : 4.5} fill="var(--ball-3)" />
          {!compact ? (
            <>
              <text x={x(refTick) + tickW / 2} y={12} textAnchor="middle" fill="var(--ink-2)" style={{ fontSize: 12 }}>
                {status === "CLOSED" ? "Last close" : "Reference"} {fmt(refTick)}
              </text>
              {!halted ? (
                <>
                  <g style={{ transform: `translateX(${x(q.bidTop) + tickW}px)`, transition: EASE }} className="motion-reduce:transition-none">
                    <text x={0} y={base + 18} textAnchor={x(q.bidTop) + tickW < 96 ? "start" : "end"} className="tnum" fill="var(--buy)" style={{ fontSize: 12 }}>
                      bid {fmt(q.bidTop)}
                    </text>
                  </g>
                  <g style={{ transform: `translateX(${x(q.askBottom)}px)`, transition: EASE }} className="motion-reduce:transition-none">
                    <text x={0} y={base + 18} textAnchor={x(q.askBottom) > W - 96 ? "end" : "start"} className="tnum" fill="var(--sell)" style={{ fontSize: 12 }}>
                      ask {fmt(q.askBottom)}
                    </text>
                  </g>
                </>
              ) : (
                <text x={W / 2} y={base - 40} textAnchor="middle" fill="var(--halt)" style={{ fontSize: 13 }}>
                  No quotes while the primary market is halted
                </text>
              )}
            </>
          ) : null}
        </svg>
      </div>

      {!compact ? (
        <>
          <div className="mt-5 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-end md:gap-8">
            <div role="radiogroup" aria-label="Regime" className="grid grid-cols-2 gap-1 rounded-[22px] bg-sunken p-1 sm:grid-cols-4 sm:rounded-full">
              {REGIMES.map(([s, label]) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => setStatus(s)}
                  className={`press min-h-10 rounded-full px-3 text-sm font-medium transition-colors ${status === s ? "bg-raised text-ink shadow-sm" : "text-ink-2 hover-fine:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor={sliderId} className="flex justify-between text-xs text-ink-3">
                <span>Vault inventory</span>
                <span className="tnum">
                  {weight}% {spec.ticker} · {100 - weight}% AUSD
                </span>
              </label>
              <input
                id={sliderId}
                type="range"
                min={0}
                max={100}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                aria-valuetext={`${weight} percent ${spec.ticker}`}
                className="mt-2 w-full accent-[var(--ink)]"
              />
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 text-sm md:grid-cols-4">
            <div>
              <dt className="text-ink-3">Half-spread</dt>
              <dd className="tnum mt-0.5 text-ink">{halted ? "None" : `$${(q.half * unit).toFixed(decimals)} · ${bp.toFixed(0)} bp`}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Inventory lean</dt>
              <dd className="mt-0.5 text-ink">{halted ? "None" : q.skew === 0 ? "Centered" : q.skew > 0 ? `${q.skew} ticks down, to sell ${spec.ticker}` : `${-q.skew} ticks up, to buy ${spec.ticker}`}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Depth per tick</dt>
              <dd className="tnum mt-0.5 text-ink">{halted ? "None" : `${perTick.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${spec.ticker}`}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Each side</dt>
              <dd className="tnum mt-0.5 text-ink">{halted ? "None" : `${p.widthTicks} ticks, capped at ${(p.maxAuctionBps / 100).toFixed(0)}% of NAV an auction`}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </div>
  );
}
