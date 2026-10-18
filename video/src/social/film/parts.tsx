import { useId } from "react";
import { interpolate } from "remotion";
import { F, settle } from "../../brand";
import { LIGHT } from "../horology/materials";

/**
 * The film's own pieces, drawn in the house's engraved line: the sniper's reticle, the resonance a strike sends out
 * (the mark's own motion: hairline arcs expanding), the stamp the old rule's pot was paid under, and a counter whose
 * digits never jump. Times are seconds of the scene.
 */
const ink = LIGHT.porcelain.ink;
const garnet = LIGHT.porcelain.sell;
/** stamp ink: a deeper red than the garnet token, the colour a pad leaves on cotton stock */
const stampInk = "oklch(0.43 0.15 27)";
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A sheet on the set, and where a point on it lands on the frame once it is rotated. */
export interface Sheet {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
}
export function onSheet(sh: Sheet, lx: number, ly: number) {
  const a = (sh.rotate * Math.PI) / 180;
  const dx = lx - sh.w / 2;
  const dy = ly - sh.h / 2;
  return { x: sh.x + sh.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: sh.y + sh.h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** A decaying shake, for an impact at `at` (px). */
export function shake(t: number, at: number, amp = 8, dur = 0.32) {
  const p = (t - at) / dur;
  if (p < 0 || p > 1) return { x: 0, y: 0 };
  const k = amp * (1 - p) ** 2;
  return { x: k * Math.sin(p * 47), y: k * Math.cos(p * 39) };
}

/**
 * The sniper's reticle, engraved: a ring, a crosshair broken at the centre, mil ticks, heavy posts at the rim, and four
 * brackets that close in as it locks. `lock` 0 → 1.
 */
export function Reticle({ x, y, size = 380, lock = 0, opacity = 1, scale = 1, rot = 0 }: { x: number; y: number; size?: number; lock?: number; opacity?: number; scale?: number; rot?: number }) {
  if (opacity <= 0) return null;
  const r = size / 2;
  const b = r * (1.32 - 0.22 * lock);
  const arm = r * 0.22;
  const ticks: number[] = [];
  for (let k = 0.2; k <= 0.7; k += 0.1) ticks.push(k);
  return (
    <svg
      width={size * 2}
      height={size * 2}
      viewBox={`${-size} ${-size} ${size * 2} ${size * 2}`}
      style={{ position: "absolute", left: x - size, top: y - size, opacity, transform: `rotate(${rot}deg) scale(${scale})`, overflow: "visible" }}
    >
      <g stroke={ink} fill="none" strokeLinecap="round">
        <circle r={r} strokeWidth={2.6} strokeOpacity={0.85} />
        <circle r={r * 0.975} strokeWidth={0.9} strokeOpacity={0.45} />
        <circle r={r * 0.3} strokeWidth={1.3} strokeOpacity={0.55} />
        {[0, 90, 180, 270].map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <line x1={r * 0.1} y1={0} x2={r} y2={0} strokeWidth={1.7} strokeOpacity={0.85} />
            <line x1={r * 0.74} y1={0} x2={r} y2={0} strokeWidth={7} strokeOpacity={0.9} />
            {ticks.map((k) => (
              <line key={k} x1={r * k} y1={-r * 0.035} x2={r * k} y2={r * 0.035} strokeWidth={1.4} strokeOpacity={0.7} />
            ))}
          </g>
        ))}
        {[45, 135, 225, 315].map((a) => {
          const p = b / Math.SQRT2;
          return <path key={a} transform={`rotate(${a - 45})`} d={`M ${p - arm},${-p} L ${p},${-p} L ${p},${-p + arm}`} strokeWidth={3} strokeOpacity={0.35 + 0.55 * lock} />;
        })}
      </g>
      <circle r={4.5 + 2.5 * lock} fill={garnet} opacity={0.55 + 0.45 * lock} />
    </svg>
  );
}

/** Resonance: two hairline arcs either side of a struck point, expanding and fading, as a struck fork's sound would. */
export function Arcs({ t, at, x, y, r0, r1, dur = 0.85, color = ink, width = 1.8 }: { t: number; at: number; x: number; y: number; r0: number; r1?: number; dur?: number; color?: string; width?: number }) {
  const p = clamp01((t - at) / dur);
  if (p <= 0 || p >= 1) return null;
  const end = r1 ?? r0 + 230;
  const arc = (r: number, a0: number, a1: number) => {
    const p0 = { x: x + r * Math.cos((a0 * Math.PI) / 180), y: y + r * Math.sin((a0 * Math.PI) / 180) };
    const p1 = { x: x + r * Math.cos((a1 * Math.PI) / 180), y: y + r * Math.sin((a1 * Math.PI) / 180) };
    return `M ${p0.x.toFixed(1)},${p0.y.toFixed(1)} A ${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  };
  const waves = [0, 0.18].map((lag) => {
    const q = clamp01((p - lag) / (1 - lag));
    return { r: r0 + (end - r0) * settle(q), o: (1 - q) ** 1.4 * (lag ? 0.4 : 0.8) };
  });
  return (
    <svg width={1080} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      {waves.map((w, i) =>
        w.o > 0.01 ? (
          <g key={i} fill="none" stroke={color} strokeWidth={width} strokeOpacity={w.o} strokeLinecap="round">
            <path d={arc(w.r, -42, 42)} />
            <path d={arc(w.r, 138, 222)} />
          </g>
        ) : null,
      )}
    </svg>
  );
}

/**
 * The stamp the old rule's pot was paid under: a garnet double ring, PAID across it, worn where the ink didn't take.
 * It slams in at `at` (from 1.7×, settling).
 */
export function Stamp({ t, at, x, y, size = 270, rotate = -11, word = "PAID", ring = "OLD RULE · POT PAID OUT · 8 OCTOBER · " }: { t: number; at: number; x: number; y: number; size?: number; rotate?: number; word?: string; ring?: string }) {
  const id = useId().replace(/:/g, "");
  if (t < at) return null;
  const k = interpolate(t, [at, at + 0.11, at + 0.2], [1.7, 0.97, 1], { extrapolateRight: "clamp" });
  const o = interpolate(t, [at, at + 0.05], [0, 0.9], { extrapolateRight: "clamp" });
  const r = 100;
  return (
    <svg width={size} height={size} viewBox="-120 -120 240 240" style={{ position: "absolute", left: x - size / 2, top: y - size / 2, opacity: o, transform: `rotate(${rotate}deg) scale(${k})`, overflow: "visible", mixBlendMode: "multiply" }}>
      <defs>
        <filter id={`worn-${id}`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={8} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.0 1.95" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <path id={`ring-${id}`} d={`M 0,0 m -${r * 0.79},0 a ${r * 0.79},${r * 0.79} 0 1,1 ${r * 1.58},0 a ${r * 0.79},${r * 0.79} 0 1,1 -${r * 1.58},0`} />
      </defs>
      <g filter={`url(#worn-${id})`} fill="none" stroke={stampInk}>
        <circle r={r} strokeWidth={7} />
        <circle r={r * 0.9} strokeWidth={2.2} />
        <circle r={r * 0.62} strokeWidth={2.2} />
        <text fill={stampInk} stroke="none" style={{ fontFamily: F.wide, fontWeight: 600, fontSize: 15.5, letterSpacing: "0.12em" }}>
          <textPath href={`#ring-${id}`} startOffset="0">
            {ring.repeat(2)}
          </textPath>
        </text>
        <rect x={-r * 0.96} y={-24} width={r * 1.92} height={48} fill="#fbf9f3" stroke={stampInk} strokeWidth={4} />
        <text x={0} y={2} textAnchor="middle" dominantBaseline="central" fill={stampInk} stroke="none" style={{ fontFamily: F.wide, fontWeight: 600, fontSize: 40, letterSpacing: "0.16em" }}>
          {word}
        </text>
      </g>
    </svg>
  );
}

/** Digits in fixed slots, so a counting number never changes its width. */
export function Digits({ value, size, family = F.display, color = ink }: { value: number; size: number; family?: string; color?: string }) {
  return (
    <span style={{ display: "inline-flex", fontFamily: family, fontSize: size, lineHeight: 1, color }}>
      {String(value)
        .split("")
        .map((d, i) => (
          <span key={i} style={{ display: "inline-block", width: size * 0.58, textAlign: "center" }}>
            {d}
          </span>
        ))}
    </span>
  );
}
