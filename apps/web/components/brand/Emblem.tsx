"use client";

import { forwardRef, useId, useImperativeHandle, useRef, type CSSProperties } from "react";
import { MARK_BOX, MARK_MID_BOX, MARK_MID_PARTS, MARK_PARTS, MARK_SMALL_PARTS } from "./geometry";
import { masterForSize, type Master } from "./master";

export interface EmblemHandle {
  /** A fill: the tines flex in antiphase (≤ 1 px at the rendered size) and settle within three beats. */
  strike: (intensity?: number) => void;
}

interface EmblemProps {
  /** Rendered size in px (also picks the optical master when `master` is "auto"). */
  size?: number;
  master?: "auto" | Master;
  /** Finish the ball: blued steel by day, lume by night. Off = monochrome (engraving, print). */
  jewel?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A struck tuning fork is a damped oscillator; sampled into WAAPI keyframes so each strike can interrupt the last. */
function flex(amplitudeDeg: number, sign: 1 | -1): Keyframe[] {
  const frames: Keyframe[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 0.8;
    const a = amplitudeDeg * Math.exp(-5.5 * t) * Math.sin(2 * Math.PI * 5 * t);
    frames.push({ transform: `skewX(${(sign * a).toFixed(4)}deg)`, offset: i / steps });
  }
  return frames;
}

/**
 * The Unison mark. Static by default. `ref.strike()` plays a fill: the tines are clipped copies of one outline,
 * skewed about the top of the bowl so the casting never tears, and the ball (the reference) never moves.
 */
export const Emblem = forwardRef<EmblemHandle, EmblemProps>(function Emblem(
  { size = 28, master = "auto", jewel = false, title, className, style },
  ref,
) {
  const uid = useId().replace(/:/g, "");
  const host = useRef<SVGSVGElement>(null);
  const left = useRef<SVGGElement>(null);
  const right = useRef<SVGGElement>(null);
  const m: Master = master === "auto" ? masterForSize(size) : master;
  const parts = m === "small" ? MARK_SMALL_PARTS : m === "mid" ? MARK_MID_PARTS : MARK_PARTS;
  const box = m === "mid" ? MARK_MID_BOX : MARK_BOX;
  const yc = box.yc;

  useImperativeHandle(ref, () => ({
    strike(intensity = 1) {
      if (m === "small" || reduced()) return;
      const px = host.current?.getBoundingClientRect().height || size;
      const tinePx = ((yc - box.top) / 48) * px;
      const maxDeg = (Math.atan(1 / Math.max(8, tinePx)) * 180) / Math.PI; // ≤ 1 px at the tine tips
      const amp = maxDeg * Math.max(0.3, Math.min(1, intensity));
      const opts: KeyframeAnimationOptions = { duration: 800, easing: "linear" };
      left.current?.animate(flex(amp, 1), opts);
      right.current?.animate(flex(amp, -1), opts);
    },
  }));

  const body = parts.filter((p) => p.role === "body").map((p) => p.d).join(" ");
  const ball = parts.filter((p) => p.role !== "body").map((p) => p.d).join(" ");
  const ballFill = jewel ? `url(#${uid}-ball)` : "currentColor";

  return (
    <svg
      ref={host}
      viewBox="0 0 48 48"
      width={size || undefined}
      height={size || undefined}
      className={className}
      style={{ overflow: "visible", ...style }}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        {/* Blued steel by day, lume by night: the stops read theme tokens (globals.css --ball-*). */}
        <radialGradient id={`${uid}-ball`} cx="0.38" cy="0.34" r="0.72">
          <stop offset="0" style={{ stopColor: "var(--ball-1)" }} />
          <stop offset="0.4" style={{ stopColor: "var(--ball-2)" }} />
          <stop offset="0.82" style={{ stopColor: "var(--ball-3)" }} />
          <stop offset="1" style={{ stopColor: "var(--ball-4)" }} />
        </radialGradient>
        <clipPath id={`${uid}-l`}>
          <rect x="-4" y="-4" width="28" height={yc + 4} />
        </clipPath>
        <clipPath id={`${uid}-r`}>
          <rect x="24" y="-4" width="28" height={yc + 4} />
        </clipPath>
        <clipPath id={`${uid}-b`}>
          <rect x="-4" y={yc - 0.3} width="56" height={52.3 - yc} />
        </clipPath>
      </defs>
      <g fill="currentColor">
        <path d={body} clipPath={`url(#${uid}-b)`} />
        <g ref={left} style={{ transformOrigin: `24px ${yc}px`, transformBox: "view-box" }}>
          <path d={body} clipPath={`url(#${uid}-l)`} />
        </g>
        <g ref={right} style={{ transformOrigin: `24px ${yc}px`, transformBox: "view-box" }}>
          <path d={body} clipPath={`url(#${uid}-r)`} />
        </g>
        <path d={ball} fill={ballFill} />
      </g>
    </svg>
  );
});
