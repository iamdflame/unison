import { interpolate } from "remotion";
import { C, F, settle } from "../brand";

/** The bounty videos' diagram pieces: a heading, a box, an arrow. */
export const ramp = (t: number, a: number, b: number) => settle(interpolate(t, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

export function Head({ eyebrow, title, show }: { eyebrow: string; title: string; show: number }) {
  return (
    <div style={{ position: "absolute", top: 70, left: 140, opacity: show }}>
      <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink3, letterSpacing: "0.14em" }}>{eyebrow}</div>
      <div style={{ fontFamily: F.display, fontSize: 76, marginTop: 8, color: C.ink }}>{title}</div>
    </div>
  );
}

export function Node({ x, y, w, title, sub, show, color = C.ink }: { x: number; y: number; w: number; title: string; sub: string; show: number; color?: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, padding: "26px 28px", borderRadius: 22, background: C.raised, boxShadow: `0 0 0 1px ${C.lineStrong}`, opacity: show, transform: `translateY(${(1 - show) * 14}px)` }}>
      <div style={{ fontFamily: F.text, fontSize: 30, fontWeight: 600, color }}>{title}</div>
      <div style={{ fontFamily: F.text, fontSize: 21, color: C.ink3, marginTop: 8, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

export function Arrow({ x0, x1, y, label, show, color = C.ink3 }: { x0: number; x1: number; y: number; label: string; show: number; color?: string }) {
  return (
    <div style={{ position: "absolute", left: x0, top: y, width: (x1 - x0) * show, opacity: show > 0 ? 1 : 0 }}>
      <div style={{ height: 2, background: color }} />
      <div style={{ position: "absolute", right: -2, top: -6, width: 0, height: 0, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", borderLeft: `12px solid ${color}`, opacity: show > 0.95 ? 1 : 0 }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 12, textAlign: "center", fontFamily: F.mono, fontSize: 18, color, whiteSpace: "nowrap", opacity: show }}>{label}</div>
    </div>
  );
}
