"use client";

import { useEffect, useRef } from "react";
import { BEAT_MS } from "@/lib/motion/tokens";

/**
 * The batch ring: ten marks round a small dial, and a pointer that steps once per 300 ms batch with an escapement
 * impulse (no sweep). Geometry only: a 3.33 Hz beat must never be a brightness flash (WCAG 2.3.1).
 */
export function BatchRing({ size = 22, block }: { size?: number; block: number | null }) {
  const pointer = useRef<SVGGElement>(null);
  const last = useRef(0);
  const swing = useRef<Animation | null>(null);

  useEffect(() => {
    const g = pointer.current;
    if (!g || block === null) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = (block % 10) * 36;
    const from = last.current;
    const to = target < from % 360 ? from - (from % 360) + 360 + target : from - (from % 360) + target;
    last.current = to;
    g.style.transform = `rotate(${to}deg)`;
    if (reduce) return;
    swing.current?.cancel();
    swing.current = g.animate(
      [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to + 0.6}deg)`, offset: 0.45 }, { transform: `rotate(${to}deg)` }],
      { duration: Math.min(90, BEAT_MS / 3), easing: "linear" },
    );
  }, [block]);

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--line-strong)" />
      {Array.from({ length: 10 }, (_, i) => (
        <line key={i} x1="12" y1="2.6" x2="12" y2="4.2" stroke="var(--ink-3)" strokeWidth="1" transform={`rotate(${i * 36} 12 12)`} />
      ))}
      <g ref={pointer} style={{ transformOrigin: "12px 12px", transformBox: "view-box" }}>
        <line x1="12" y1="12" x2="12" y2="4.8" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <circle cx="12" cy="12" r="2.2" style={{ fill: "var(--ball)" }} />
    </svg>
  );
}
