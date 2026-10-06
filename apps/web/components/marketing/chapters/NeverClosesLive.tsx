"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInView } from "@/components/motion/useInView";
import { marketByTicker } from "@/lib/content/markets";
import { regimeNow } from "@/lib/unison/regimeNow";
import { bandChart, CW, nowSlot, polar, T_MAX } from "./neverClosesGeometry";

/** Chapter 3's only browser code: the moment it comes into view, and the two marks that say "now". */

/** Marks its div data-shown once a third of it is on screen, so the engraving draws itself in CSS. */
export function Reveal({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useInView(ref, { threshold: 0.3 });
  return (
    <div ref={ref} data-shown={shown || undefined} className={className}>
      {children}
    </div>
  );
}

function useNow(everyMs: number) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [everyMs]);
  return now;
}

/** The week dial's one moving hand, in blued steel, at this half hour in New York. */
export function WeekHand() {
  const now = useNow(60_000);
  if (!now) return null;
  const slot = nowSlot(now);
  const [x1, y1] = polar(176, slot);
  const [x2, y2] = polar(262, slot);
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <circle cx={x2} cy={y2} r="3.5" fill="var(--accent)" />
    </g>
  );
}

/** Today's place on NVDA's discovery band while the market is shut: the band as the venue computes it now. */
export function BandNow() {
  const now = useNow(60_000);
  if (!now) return null;
  const nvda = marketByTicker("aNVDA")!;
  const regime = regimeNow(nvda, now);
  const sinceClose = regime.closedSince ? (now.getTime() - regime.closedSince.getTime()) / 3_600_000 : null;
  if (sinceClose === null || sinceClose > T_MAX) return null;
  const { cx, cy } = bandChart(nvda);
  // the contract's integer math, not the curve's float
  const nowBand = regime.bandBps / 100;
  const right = cx(sinceClose) > CW * 0.3;
  return (
    <g>
      <line x1={cx(sinceClose)} x2={cx(sinceClose)} y1={cy(0)} y2={cy(nowBand)} stroke="var(--ink)" strokeDasharray="2 4" />
      <circle cx={cx(sinceClose)} cy={cy(nowBand)} r="5" fill="var(--accent)" />
      {/* up and to the left of the dot, where the rising band never is (flipped only near the close); a halo in the page
          color keeps grid hairlines off the figures */}
      <text
        x={cx(sinceClose) + (right ? -12 : 12)}
        y={cy(nowBand) - 24}
        textAnchor={right ? "end" : "start"}
        className="tnum"
        fill="var(--ink)"
        stroke="var(--bg)"
        strokeWidth={5}
        strokeLinejoin="round"
        paintOrder="stroke"
        style={{ fontSize: 13, fontWeight: 600 }}
      >
        Now ±{nowBand.toFixed(2)}%
      </text>
    </g>
  );
}
