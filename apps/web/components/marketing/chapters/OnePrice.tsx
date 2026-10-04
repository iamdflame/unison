"use client";

import NumberFlow from "@number-flow/react";
import { Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearBatch, curves, seededOrders, type BatchOutcome, type SimOrder } from "@/lib/sim/batch";
import { BEAT_MS } from "@/lib/motion/tokens";

/**
 * Chapter 1: one price for everyone. A batch forms one order per beat; buyers (demand) and sellers (supply) line
 * up by price; where the lines cross is the price, and everyone in the batch trades there. Visitors can add their
 * own order to the next batch and see exactly how it fills. Runs the real clearing engine.
 */
const REF = 18120; // $181.20
const BAND = { lo: REF - 181, hi: REF + 181, refTick: REF }; // ±1% (LIVE)
const WIN = { lo: REF - 30, hi: REF + 30 };
const W = 960;
const H = 500;
const PAD = { l: 44, r: 44, t: 96, b: 64 };
const usd = (tick: number) => `$${(tick / 100).toFixed(2)}`;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type Phase = "forming" | "cleared";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function OnePrice() {
  const [seed, setSeed] = useState(3);
  // At rest it shows a finished batch (the watch at 10:10): every order in, one price struck through both sides.
  const [arrived, setArrived] = useState(12);
  const [phase, setPhase] = useState<Phase>("cleared");
  const [mine, setMine] = useState<SimOrder[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [limit, setLimit] = useState(REF + 10);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLElement>(null);
  const [interacted, setInteracted] = useState(false);

  const crowd = useMemo(() => seededOrders(seed, REF, 12), [seed]);
  const orders = useMemo(() => [...crowd.slice(0, arrived), ...mine], [crowd, arrived, mine]);
  const outcome: BatchOutcome | null = useMemo(
    () => (phase === "cleared" ? clearBatch(orders, BAND) : null),
    [phase, orders],
  );

  // Pause the escapement when the instrument is off screen.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Escapement: one order per beat, then the batch clears, holds, and the next one forms.
  useEffect(() => {
    if (!visible) return;
    if (reduced()) {
      const id = setTimeout(() => {
        setArrived(crowd.length);
        setPhase("cleared");
      }, 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(
      () => {
        if (phase === "forming") {
          if (arrived < crowd.length) setArrived((n) => n + 1);
          else setPhase("cleared");
        } else {
          setPhase("forming");
          setArrived(0);
          setMine([]);
          setSeed((s) => s + 1);
        }
      },
      phase === "forming" ? BEAT_MS * (arrived < crowd.length ? 1 : 2) : mine.length ? 6000 : 3600,
    );
    return () => clearTimeout(id);
  }, [visible, phase, arrived, crowd.length, mine.length]);

  const addMine = useCallback(() => {
    setInteracted(true);
    setMine((m) => [...m, { id: 1000 + m.length, side, tick: limit, qty: 2, you: true }]);
    if (phase === "cleared") {
      setPhase("forming");
      setArrived(crowd.length);
    }
  }, [side, limit, phase, crowd.length]);

  // Geometry
  const { ticks, demand, supply } = useMemo(() => curves(orders, WIN.lo, WIN.hi), [orders]);
  const maxQ = Math.max(8, ...demand, ...supply) * 1.12;
  const x = (t: number) => PAD.l + ((t - WIN.lo) / (WIN.hi - WIN.lo)) * (W - PAD.l - PAD.r);
  const y = (q: number) => H - PAD.b - (q / maxQ) * (H - PAD.t - PAD.b);
  // Step curves centred on each tick: demand(t) = buy size with limit ≥ t, supply(t) = sell size with limit ≤ t.
  const step = (vals: number[]) => {
    let d = "";
    vals.forEach((v, i) => {
      const tk = ticks[i]!;
      d += i === 0 ? `M${x(tk - 0.5).toFixed(1)},${y(v).toFixed(1)}` : `V${y(v).toFixed(1)}`;
      d += `H${x(tk + 0.5).toFixed(1)}`;
    });
    return d;
  };
  const area = (vals: number[]) => `${step(vals)}V${y(0).toFixed(1)}H${x(WIN.lo - 0.5).toFixed(1)}Z`;

  const t = outcome?.traded ? outcome.tick : null;
  const vol = outcome?.volume ?? 0;
  const you = mine.at(-1);
  const yourFill = you && outcome ? (outcome.fills.get(you.id) ?? 0) : 0;
  const buyers = orders.filter((o) => o.side === "buy").length;
  const sellers = orders.length - buyers;

  return (
    <section id="one-price" ref={root} aria-labelledby="one-price-title" className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 lg:px-12 lg:py-32">
      <div className="grid grid-cols-1 gap-x-12 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2 id="one-price-title" className="text-display-l text-ink">
            One price for everyone.
          </h2>
          <p className="text-lede mt-6 text-ink-2">
            Orders that arrive in the same batch are filled together (a batch every 300 ms in market hours, every 3 seconds overnight). Buyers and sellers line up by price,
            and the batch clears where they meet. Arriving first buys you nothing.
          </p>

          <div className="mt-10 rounded-[var(--radius-xl)] bg-raised p-5 shadow-md">
            <p className="text-sm font-medium text-ink">Add your order to the next batch</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div role="radiogroup" aria-label="Side" className="flex rounded-full bg-sunken p-1">
                {(["buy", "sell"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={side === s}
                    onClick={() => {
                      setSide(s);
                      setLimit(s === "buy" ? REF + 10 : REF - 10);
                    }}
                    className={`press rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors duration-150 ${
                      side === s ? (s === "buy" ? "bg-buy-fill text-bg" : "bg-sell-fill text-bg") : "text-ink-2 hover-fine:text-ink"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex items-center rounded-full bg-sunken p-1" role="group" aria-label="Limit price">
                <button type="button" aria-label="Lower limit by one cent" onClick={() => setLimit((l) => l - 1)} className="press grid size-8 place-items-center rounded-full text-ink-2 hover-fine:bg-bg">
                  <Minus size={14} strokeWidth={1.75} aria-hidden />
                </button>
                <output className="tnum w-[7.5ch] text-center text-sm font-semibold text-ink" aria-live="off">
                  {usd(limit)}
                </output>
                <button type="button" aria-label="Raise limit by one cent" onClick={() => setLimit((l) => l + 1)} className="press grid size-8 place-items-center rounded-full text-ink-2 hover-fine:bg-bg">
                  <Plus size={14} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
              <button type="button" onClick={addMine} className="press rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-bg">
                Add 2 shares
              </button>
            </div>
            <p className="mt-4 min-h-[3lh] text-sm leading-relaxed text-ink-2" aria-live={interacted ? "polite" : "off"}>
              {you && outcome && t !== null
                ? yourFill >= you.qty
                  ? `Your ${you.side} filled in full at ${usd(t)}, the same price as everyone in the batch${
                      you.side === "buy" && you.tick > t ? `, ${usd(you.tick - t)} better than your limit` : you.side === "sell" && you.tick < t ? `, ${usd(t - you.tick)} better than your limit` : ""
                    }.`
                  : yourFill > 0
                    ? `Your limit was exactly the clearing price, so it shared the last level pro rata: ${yourFill} of ${you.qty} shares at ${usd(t)}.`
                    : `Not filled: the batch cleared at ${usd(t)}, ${you.side === "buy" ? "above" : "below"} your limit.`
                : you
                  ? "Your order is in. It clears with everyone else's at the next beat."
                  : "Try a buy above the reference or a sell below it, and watch the cross move."}
            </p>
          </div>
        </div>

        <div className="lg:col-span-8">
          <figure className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full"
              role="img"
              aria-label={
                t !== null
                  ? `This batch: ${buyers} buyers and ${sellers} sellers cleared ${vol.toFixed(1)} shares at one price, ${usd(t)}.`
                  : `A batch forming: ${plural(buyers, "buyer")} and ${plural(sellers, "seller")} so far.`
              }
            >
              {/* Faint quantity rules */}
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1={PAD.l} x2={W - PAD.r} y1={y(maxQ * f)} y2={y(maxQ * f)} stroke="var(--line)" strokeWidth="1" />
              ))}
              <path d={area(demand)} fill="var(--buy-soft)" />
              <path d={area(supply)} fill="var(--sell-soft)" />
              <path d={step(demand)} fill="none" stroke="var(--buy)" strokeWidth="2" strokeLinejoin="round" />
              <path d={step(supply)} fill="none" stroke="var(--sell)" strokeWidth="2" strokeLinejoin="round" />

              {/* Axis and reference */}
              <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
              {Array.from({ length: 7 }, (_, i) => WIN.lo + i * 10).map((tk) => (
                <g key={tk}>
                  <line x1={x(tk)} x2={x(tk)} y1={y(0)} y2={y(0) + 6} stroke="var(--ink-3)" />
                  <text x={x(tk)} y={y(0) + 26} textAnchor="middle" className="tnum" fill="var(--ink-3)" style={{ fontSize: 14 }}>
                    {usd(tk)}
                  </text>
                </g>
              ))}
              <path d={`M${x(REF)},${y(0) + 8} l-6,10 h12 z`} fill="var(--ink-2)" />
              <text x={x(REF)} y={y(0) + 50} textAnchor="middle" className="dial-label" fill="var(--ink-2)" style={{ fontSize: 11 }}>
                REFERENCE
              </text>

              {/* Your orders, at their limits */}
              {mine.map((o) => (
                <g key={o.id}>
                  <circle cx={x(o.tick)} cy={y(0)} r="5" fill="var(--accent)" />
                </g>
              ))}

              {/* The cross: one price for everyone */}
              {t !== null ? (
                <g>
                  <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(vol)} stroke="var(--ink)" strokeWidth="1" strokeDasharray="2 4" />
                  <defs>
                    <radialGradient id="crossBall" cx="0.38" cy="0.34" r="0.72">
                      <stop offset="0" style={{ stopColor: "var(--ball-1)" }} />
                      <stop offset="0.4" style={{ stopColor: "var(--ball-2)" }} />
                      <stop offset="0.82" style={{ stopColor: "var(--ball-3)" }} />
                      <stop offset="1" style={{ stopColor: "var(--ball-4)" }} />
                    </radialGradient>
                  </defs>
                  <circle cx={x(t)} cy={y(vol)} r="9" fill="url(#crossBall)" />
                </g>
              ) : null}
            </svg>

            {/* The instrument's readout: the one price this batch, engraved */}
            <div aria-hidden className="pointer-events-none absolute top-0 right-[4.6%] text-right">
              <div
                className="numerals text-[clamp(1.75rem,3vw,2.75rem)] leading-none text-ink transition-opacity duration-200"
                style={{ opacity: t !== null ? 1 : 0.35 }}
              >
                <NumberFlow value={(t ?? REF) / 100} locales="en-US" format={{ style: "currency", currency: "USD" }} />
              </div>
              <p className="dial-label mt-2 text-ink-3">{t !== null ? `${vol.toFixed(1)} shares · everyone` : "forming"}</p>
            </div>

            <figcaption className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-3">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-5 rounded bg-buy" /> Buyers, by limit
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-5 rounded bg-sell" /> Sellers, by limit
              </span>
              <span className="tnum">
                {phase === "forming" ? `Batch forming · ${plural(orders.length, "order")}` : `Cleared · ${plural(buyers, "buyer")}, ${plural(sellers, "seller")}, one price`}
              </span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
