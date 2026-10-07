import type { CSSProperties, ReactNode } from "react";
import { C, F } from "../../brand";
import script from "../../data/script.json";
import { clamp01, glow, Label, move, pop, useT } from "../../kit/Fx";

/**
 * The bounty films' pieces, in the films' one style: a node that lights when the story reaches it, an arrow with a
 * pulse running along it, a card that lands when its result does, a command as a chip, a number as a stat.
 */

/** A voice file's lines for <Narration>: each from when it is said (`at`, seconds of the scene) until the next. */
export const said = (id: keyof typeof script, at: number[], last = 99) =>
  script[id].map((l, i) => ({ text: l.text, at: at[i]!, until: at[i + 1] !== undefined ? at[i + 1]! - 0.1 : last }));

/** A box in a diagram: a title, a line under it, lit (glow, colour) from `lit` on. */
export function NodeBox({ x, y, w, h = 190, title, sub, color = C.accent, at = 0, lit = 1e9, children, style }: { x: number; y: number; w: number; h?: number; title: ReactNode; sub?: ReactNode; color?: string; at?: number; lit?: number; children?: ReactNode; style?: CSSProperties }) {
  const t = useT();
  const e = move(t, at, 0.5);
  const on = move(t, lit, 0.4);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 28,
        padding: "26px 30px",
        boxSizing: "border-box",
        opacity: e,
        transform: `translateY(${(1 - e) * 24}px) scale(${0.97 + 0.03 * e + 0.02 * on})`,
        background: `linear-gradient(155deg, color-mix(in oklch, ${color} ${6 + 16 * on}%, ${C.raised}), ${C.sunken})`,
        border: `2px solid color-mix(in oklch, ${color} ${25 + 55 * on}%, transparent)`,
        boxShadow: `0 24px 70px oklch(0 0 0 / 0.45)${on > 0 ? `, ${glow(color, 0.5 * on)}` : ""}`,
        ...style,
      }}
    >
      <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 38, lineHeight: 1.1, color: C.ink }}>{title}</div>
      {sub ? <div style={{ fontFamily: F.text, fontSize: 25, lineHeight: 1.3, color: C.ink2, marginTop: 10 }}>{sub}</div> : null}
      {children}
    </div>
  );
}

/** An arrow from (x0, y0) to (x1, y1) drawn from `at`, with a pulse running along it while `flow` is on. */
export function Flow({ x0, y0, x1, y1, at, color = C.accent, label, dashed = false, period = 1.1 }: { x0: number; y0: number; x1: number; y1: number; at: number; color?: string; label?: string; dashed?: boolean; period?: number }) {
  const t = useT();
  const e = move(t, at, 0.6);
  if (e <= 0) return null;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const p = ((t - at) % period) / period;
  return (
    <>
      <div style={{ position: "absolute", left: x0, top: y0 - 2, width: len * e, height: 4, borderRadius: 2, transformOrigin: "0 50%", transform: `rotate(${ang}deg)`, background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 14px, transparent 14px 26px)` : color, opacity: 0.85, boxShadow: dashed ? undefined : glow(color, 0.3) }} />
      <div style={{ position: "absolute", left: x1 - 10, top: y1 - 10, width: 20, height: 20, borderRadius: 10, background: color, opacity: e, boxShadow: glow(color, 0.6), transform: `scale(${e})` }} />
      {e >= 1 ? <div style={{ position: "absolute", left: x0 + dx * p - 9, top: y0 + dy * p - 9, width: 18, height: 18, borderRadius: 9, background: C.ink, boxShadow: glow(color, 1) }} /> : null}
      {label ? (
        <div style={{ position: "absolute", left: (x0 + x1) / 2 - 300, top: (y0 + y1) / 2 - 58, width: 600, textAlign: "center", fontFamily: F.mono, fontSize: 24, color, opacity: e }}>
          {label}
        </div>
      ) : null}
    </>
  );
}

/** A route through several points (around a box rather than through it), drawn from `at`, a pulse running along it. */
export function Route({ points, at, color = C.accent, dashed = false, period = 1.8, dur = 0.8 }: { points: [number, number][]; at: number; color?: string; dashed?: boolean; period?: number; dur?: number }) {
  const t = useT();
  const e = move(t, at, dur);
  if (e <= 0 || points.length < 2) return null;
  const seg = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const pointAt = (dist: number): [number, number] => {
    let left = dist;
    for (let i = 0; i < seg.length; i++) {
      if (left <= seg[i]!) {
        const k = seg[i] ? left / seg[i]! : 0;
        const a = points[i]!;
        const b = points[i + 1]!;
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      }
      left -= seg[i]!;
    }
    return points.at(-1)!;
  };
  const shown = total * e;
  const drawn: [number, number][] = [points[0]!];
  let acc = 0;
  for (let i = 0; i < seg.length; i++) {
    if (acc + seg[i]! <= shown) {
      drawn.push(points[i + 1]!);
      acc += seg[i]!;
    } else {
      drawn.push(pointAt(shown));
      break;
    }
  }
  const d = drawn.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const pulse = e >= 1 ? pointAt((((t - at - dur) % period) / period) * total) : null;
  const end = points.at(-1)!;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={4} strokeDasharray={dashed ? "14 12" : undefined} strokeLinejoin="round" opacity={0.85} />
      {e >= 1 ? <circle cx={end[0]} cy={end[1]} r={9} fill={color} /> : null}
      {pulse ? <circle cx={pulse[0]} cy={pulse[1]} r={8} fill={C.ink} style={{ filter: `drop-shadow(0 0 8px ${color})` }} /> : null}
    </svg>
  );
}

/** A result, landing: a label in capitals, a large value, a line of what it means. */
export function Card({ x, y, w = 700, at, label, big, note, color = C.ink, size = 72 }: { x: number; y: number; w?: number; at: number; label: string; big: ReactNode; note?: ReactNode; color?: string; size?: number }) {
  const t = useT();
  const on = t >= at;
  const k = pop(t, at, 0.5);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        borderRadius: 26,
        padding: "24px 32px",
        boxSizing: "border-box",
        background: `linear-gradient(150deg, color-mix(in oklch, ${color} 13%, ${C.raised}), ${C.sunken})`,
        border: `1.5px solid color-mix(in oklch, ${color} ${on ? 55 : 12}%, transparent)`,
        boxShadow: on ? glow(color, 0.35) : undefined,
        opacity: on ? clamp01(k * 1.6) : 0,
        transform: `scale(${on ? 0.92 + 0.08 * Math.min(1.04, k) : 0.92})`,
        transformOrigin: "0 50%",
      }}
    >
      <Label color={color} size={24}>
        {label}
      </Label>
      <div style={{ fontFamily: F.display, fontSize: size, lineHeight: 1.08, marginTop: 6, color: C.ink }}>{big}</div>
      {note ? <div style={{ fontFamily: F.text, fontSize: 25, color: C.ink2, marginTop: 6 }}>{note}</div> : null}
    </div>
  );
}

/** A command, as a chip. */
export function Chip({ text, at, color = C.ink2, lit = false, size = 30 }: { text: string; at: number; color?: string; lit?: boolean; size?: number }) {
  const t = useT();
  const e = move(t, at, 0.45);
  return (
    <div style={{ fontFamily: F.mono, fontSize: size, color: lit ? C.ink : color, padding: "12px 20px", borderRadius: 14, background: lit ? `color-mix(in oklch, ${C.champagne} 16%, ${C.raised})` : C.raised, boxShadow: `0 0 0 1.5px ${lit ? C.champagne : C.lineStrong}${lit ? `, ${glow(C.champagne, 0.4)}` : ""}`, opacity: e, transform: `translateY(${(1 - e) * 16}px)`, whiteSpace: "nowrap" }}>
      {text}
    </div>
  );
}

/** A number that lands, with what it counts. */
export function Stat({ n, label, at, color = C.ink, size = 210 }: { n: string; label: string; at: number; color?: string; size?: number }) {
  const t = useT();
  const k = pop(t, at, 0.55);
  return (
    <div style={{ opacity: clamp01(k * 1.5), transform: `scale(${t >= at ? Math.max(0.6, k) : 0.6})`, transformOrigin: "0 70%" }}>
      <div style={{ fontFamily: F.display, fontSize: size, lineHeight: 1, color, textShadow: glow(color === C.ink ? C.champagne : color, 0.6) }}>{n}</div>
      <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 34, color: C.ink2, marginTop: 10 }}>{label}</div>
    </div>
  );
}
