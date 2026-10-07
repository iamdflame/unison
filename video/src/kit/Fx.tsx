import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, FPS, settle } from "../brand";

/**
 * The film's motion and light: the few moves every scene shares, so the whole film moves one way. Words arrive one
 * at a time, out of a blur; a key light breathes behind the frame; a sweep of light crosses what matters; a ring goes
 * out on every chime. Times are seconds of the scene.
 */
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** progress of a move from `a` over `dur` seconds, eased to settle */
export const move = (t: number, a: number, dur = 0.6) => settle(clamp01((t - a) / dur));
/** a quick overshoot, for things that land: a stamp, a number, a card (0 → past 1 → 1) */
export const pop = (t: number, a: number, dur = 0.5) => {
  const p = clamp01((t - a) / dur);
  const c1 = 1.70158;
  return p <= 0 ? 0 : 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};
export const useT = () => useCurrentFrame() / FPS;

/** Words that arrive one by one, rising out of a blur. */
export function Words({ text, at, stagger = 0.06, dur = 0.55, style, color, accent }: { text: string; at: number; stagger?: number; dur?: number; style?: CSSProperties; color?: string; accent?: Record<string, string> }) {
  const t = useT();
  return (
    <span style={{ display: "inline", ...style }}>
      {text.split(" ").map((w, i) => {
        const e = move(t, at + i * stagger, dur);
        const tint = accent?.[w.replace(/[^\w$.%+-]/g, "")];
        return (
          <span key={`${w}-${i}`} style={{ display: "inline-block", whiteSpace: "pre", opacity: e, transform: `translateY(${(1 - e) * 0.42}em)`, filter: e < 1 ? `blur(${(1 - e) * 12}px)` : undefined, color: tint ?? color }}>
            {w}
            {i < text.split(" ").length - 1 ? " " : ""}
          </span>
        );
      })}
    </span>
  );
}

/** The frame's ground: ink, a soft key light that drifts, a cool fill from the far corner, black at the edges. */
export function Backdrop({ light = C.champagne, x = 50, y = 38, strength = 0.14, fill = C.accent, base = C.deep, children }: { light?: string; x?: number; y?: number; strength?: number; fill?: string; base?: string; children?: ReactNode }) {
  const t = useT();
  const dx = 4 * Math.sin(t * 0.23);
  const dy = 3 * Math.cos(t * 0.19);
  return (
    <AbsoluteFill style={{ background: base, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 62% 58% at ${x + dx}% ${y + dy}%, color-mix(in oklch, ${light} ${Math.round(strength * 100)}%, transparent), transparent 72%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 55% 50% at ${100 - x - dx}% ${92 - y}%, color-mix(in oklch, ${fill} 7%, transparent), transparent 70%)` }} />
      {children}
    </AbsoluteFill>
  );
}

/** A slow camera on a still composition: it pushes in a little over the scene, so nothing ever sits dead. */
export function Drift({ children, from = 1, to = 1.045, over = 12, x = 0, y = 0 }: { children: ReactNode; from?: number; to?: number; over?: number; x?: number; y?: number }) {
  const t = useT();
  const p = clamp01(t / over);
  const k = from + (to - from) * p;
  return <AbsoluteFill style={{ transform: `translate(${x * p}px, ${y * p}px) scale(${k})`, transformOrigin: "50% 50%" }}>{children}</AbsoluteFill>;
}

/** A band of light that crosses its content once, from `at`, over `dur` seconds: on a wordmark, a price, a stamp. */
export function Sweep({ children, at, dur = 1.1, color = "oklch(0.99 0.02 85)", style }: { children: ReactNode; at: number; dur?: number; color?: string; style?: CSSProperties }) {
  const t = useT();
  const p = clamp01((t - at) / dur);
  const pos = -30 + 160 * settle(p);
  const on = p > 0 && p < 1;
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}>
      {children}
      {on ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            color,
            textShadow: `0 0 24px ${color}`,
            WebkitMaskImage: `linear-gradient(105deg, transparent ${pos - 14}%, black ${pos}%, transparent ${pos + 14}%)`,
            maskImage: `linear-gradient(105deg, transparent ${pos - 14}%, black ${pos}%, transparent ${pos + 14}%)`,
          }}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}

/** A ring that goes out from a point, as a struck bell's sound does. */
export function Ring({ at, x, y, size = 900, color = C.champagne, width = 2, dur = 1.6 }: { at: number; x: number; y: number; size?: number; color?: string; width?: number; dur?: number }) {
  const t = useT();
  const p = clamp01((t - at) / dur);
  if (p <= 0 || p >= 1) return null;
  const r = (size / 2) * settle(p);
  return <div style={{ position: "absolute", left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: "50%", border: `${width}px solid ${color}`, opacity: (1 - p) ** 1.4 * 0.9, boxShadow: `0 0 40px color-mix(in oklch, ${color} 40%, transparent)` }} />;
}

/** An exposure flash, for a cut that should be felt. */
export function Flash({ at, peak = 0.7, dur = 0.35, color = "white" }: { at: number; peak?: number; dur?: number; color?: string }) {
  const t = useT();
  const o = interpolate(t, [at, at + 0.03, at + dur], [0, peak, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return o > 0 ? <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: "none" }} /> : null;
}

/** A small label in capitals, spaced: what a panel or a number is. */
export const Label = ({ children, color = C.ink2, size = 30, style }: { children: ReactNode; color?: string; size?: number; style?: CSSProperties }) => (
  <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: size, letterSpacing: "0.16em", textTransform: "uppercase", color, ...style }}>{children}</div>
);

/** Glow for a hero number or word, in its own colour. */
export const glow = (color: string, k = 1) => `0 0 ${28 * k}px color-mix(in oklch, ${color} 55%, transparent), 0 0 ${80 * k}px color-mix(in oklch, ${color} 25%, transparent)`;

/**
 * The narration set in the film's type, a line at a time: for scenes drawn in motion graphics, where a caption
 * would be a subtitle on a title card. Each line from `at` until `until` (seconds of the scene), its words arriving.
 */
export function Narration({ lines, size = 60, bottom = 110, color = C.ink, accent }: { lines: { text: string; at: number; until: number }[]; size?: number; bottom?: number; color?: string; accent?: Record<string, string> }) {
  const t = useT();
  const cur = lines.find((l) => t >= l.at - 0.05 && t < l.until);
  if (!cur) return null;
  const o = Math.min(move(t, cur.at - 0.05, 0.25), 1 - clamp01((t - cur.until + 0.25) / 0.25));
  return (
    <div style={{ position: "absolute", left: 120, right: 120, bottom, textAlign: "center", opacity: o }}>
      <div style={{ fontFamily: F.displaySmall, fontSize: size, lineHeight: 1.15, color, textShadow: "0 2px 26px oklch(0 0 0 / 0.85)" }}>
        <Words text={cur.text} at={cur.at} stagger={0.06} dur={0.45} accent={accent} />
      </div>
    </div>
  );
}
