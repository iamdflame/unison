"use client";

import { useEffect, useRef } from "react";

/**
 * A dial in the house style: rose-engine guilloché at the centre, a minute track, Bodoni quarter numerals and
 * Breguet hands in the theme's finish (blued steel by day, lume by night). Time defaults to 10:10:40, the hour
 * every watch is photographed at, seconds parked clear of the name. `hacked` stops the seconds hand the way a watch does while its crown is pulled:
 * one last sweep to twelve, a hair of recoil, then stillness. With reduced motion it is simply stopped.
 */
interface WatchFaceProps {
  hours?: number;
  minutes?: number;
  seconds?: number;
  hacked?: boolean;
  /** small caption above six o'clock, set in the instrument cut */
  caption?: string;
  className?: string;
  title?: string;
}

const C = 200;

function breguet(length: number, ring: number, shaft: number) {
  // Pointing up from the centre: a tapered shaft, the hollow "pomme" ring, then a fine tip.
  const cy = -(length - ring * 3);
  const inner = ring * 0.6;
  const shaftTop = cy + ring - 0.5;
  return {
    shaft: `M${-shaft},16 L${-shaft * 0.62},${shaftTop} L${shaft * 0.62},${shaftTop} L${shaft},16 Z`,
    ring: `M0,${cy - ring} a${ring},${ring} 0 1,0 0.001,0 Z M0,${cy - inner} a${inner},${inner} 0 1,0 0.001,0 Z`,
    tip: `M${-shaft * 0.7},${cy - ring + 0.5} L0,${-length} L${shaft * 0.7},${cy - ring + 0.5} Z`,
  };
}

const HOUR = breguet(96, 9, 3.2);
const MINUTE = breguet(152, 7, 2.2);

/** Rose-engine rosette: equal circles whose centres walk a circle of their own radius, so every one passes
 *  through the centre. The moiré of a hand-turned dial. */
const ROSE_R = 56;
const ROSETTE = Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * Math.PI * 2;
  return { cx: +(C + ROSE_R * Math.cos(a)).toFixed(2), cy: +(C + ROSE_R * Math.sin(a)).toFixed(2) };
});

export function WatchFace({ hours = 10, minutes = 10, seconds = 40, hacked = false, caption, className, title }: WatchFaceProps) {
  const secRef = useRef<SVGGElement>(null);
  const hourDeg = ((hours % 12) + minutes / 60) * 30;
  const minDeg = (minutes + seconds / 60) * 6;
  const secDeg = seconds * 6;

  useEffect(() => {
    const el = secRef.current;
    if (!el || !hacked || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The last seconds before the crown is pulled: a smooth mechanical sweep, then a stop with 1.5% recoil.
    const a = el.animate(
      [
        { transform: `rotate(${secDeg - 30}deg)` },
        { transform: `rotate(${secDeg + 0.45}deg)`, offset: 0.94 },
        { transform: `rotate(${secDeg}deg)` },
      ],
      { duration: 1500, easing: "linear", delay: 250, fill: "backwards" },
    );
    return () => a.cancel();
  }, [hacked, secDeg]);

  return (
    <svg viewBox="0 0 400 400" role="img" aria-label={title ?? `A watch dial at ${hours}:${String(minutes).padStart(2, "0")}${hacked ? ", its seconds hand stopped" : ""}`} className={className}>
      <defs>
        <radialGradient id="wf-plate" cx="0.5" cy="0.42" r="0.62">
          <stop offset="0" style={{ stopColor: "var(--bg-raised)" }} />
          <stop offset="1" style={{ stopColor: "var(--bg-sunken)" }} />
        </radialGradient>
        <clipPath id="wf-centre">
          <circle cx={C} cy={C} r="112" />
        </clipPath>
      </defs>

      {/* case and plate */}
      <circle cx={C} cy={C} r="198" fill="none" stroke="var(--line-strong)" />
      <circle cx={C} cy={C} r="190" fill="url(#wf-plate)" stroke="var(--line)" />

      {/* guilloché centre */}
      <g clipPath="url(#wf-centre)" fill="none" stroke="var(--engrave)" strokeWidth="0.6">
        {ROSETTE.map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={ROSE_R} />
        ))}
      </g>
      <circle cx={C} cy={C} r="112" fill="none" stroke="var(--line)" />

      {/* minute track */}
      {Array.from({ length: 60 }, (_, i) => {
        const five = i % 5 === 0;
        return (
          <line
            key={i}
            x1={C}
            y1={five ? 22 : 24}
            x2={C}
            y2={five ? 38 : 31}
            stroke={five ? "var(--ink-2)" : "var(--ink-3)"}
            strokeWidth={i % 15 === 0 ? 2.4 : five ? 1.6 : 0.8}
            transform={`rotate(${i * 6} ${C} ${C})`}
          />
        );
      })}

      {/* quarter numerals */}
      {[
        ["12", C, 72],
        ["3", 332, C],
        ["6", C, 330],
        ["9", 68, C],
      ].map(([n, x, y]) => (
        <text key={n} x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="var(--ink)" style={{ fontFamily: "var(--font-display)", fontSize: 30, fontVariationSettings: "'opsz' 28" }}>
          {n}
        </text>
      ))}
      <text x={C} y="110" textAnchor="middle" fill="var(--ink-2)" style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: "0.32em" }}>
        UNISON
      </text>
      {caption ? (
        <text x={C} y="290" textAnchor="middle" fill="var(--ink-3)" style={{ fontSize: 8.5, letterSpacing: "0.22em", fontStretch: "125%", fontWeight: 600 }}>
          {caption.toUpperCase()}
        </text>
      ) : null}

      {/* hands */}
      <g transform={`translate(${C} ${C}) rotate(${hourDeg})`} fill="var(--ball-3)">
        <path d={HOUR.shaft} />
        <path d={HOUR.ring} fillRule="evenodd" />
        <path d={HOUR.tip} />
      </g>
      <g transform={`translate(${C} ${C}) rotate(${minDeg})`} fill="var(--ball-3)">
        <path d={MINUTE.shaft} />
        <path d={MINUTE.ring} fillRule="evenodd" />
        <path d={MINUTE.tip} />
      </g>
      <g transform={`translate(${C} ${C})`}>
        <g ref={secRef} style={{ transform: `rotate(${secDeg}deg)` }}>
          <line x1="0" y1="44" x2="0" y2="-168" stroke="var(--sell)" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="0" cy="34" r="4.2" fill="var(--sell)" />
        </g>
        <circle r="6.5" fill="var(--ball-3)" />
        <circle r="2.2" fill="var(--bg-raised)" />
      </g>
    </svg>
  );
}
