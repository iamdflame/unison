import type { CSSProperties } from "react";
import { MARK_MID_PARTS } from "./geometry";
import { LOCKUP_MARK, WORDMARK, WORDMARK_CAP } from "./glyphs";

interface LockupProps {
  /** Cap height of the wordmark in px; the mark's tines meet the cap line and its bowl sits on the baseline. */
  capHeight?: number;
  /** Paint the ball with the theme's finish (blued steel / lume). */
  jewel?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/**
 * Mark and wordmark as one piece of typography: one SVG, one baseline. The stem and ball hang below the baseline
 * like a descender, so the pair aligns to text instead of being centred by flexbox.
 */
export function Lockup({ capHeight = 12, jewel = true, className, style, title = "Unison" }: LockupProps) {
  const w = WORDMARK.text;
  const m = LOCKUP_MARK;
  const gap = 0.8 * 2000; // em → font units
  const markX = w.left - gap - m.width;
  const tx = markX - (24 - m.R) * m.scale;
  const ty = -m.top * m.scale;
  const top = Math.min(w.top, 0);
  const bottom = WORDMARK_CAP + m.descent + 10;
  const vbW = w.left + w.width - markX;
  const vbH = bottom - top;
  const k = capHeight / WORDMARK_CAP;
  const body = MARK_MID_PARTS.filter((p) => p.role === "body").map((p) => p.d).join(" ");
  const ball = MARK_MID_PARTS.filter((p) => p.role !== "body").map((p) => p.d).join(" ");
  return (
    <svg
      viewBox={`${markX} ${top} ${vbW} ${vbH}`}
      width={vbW * k}
      height={vbH * k}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      className={className}
      style={{ overflow: "visible", ...style }}
    >
      {title ? <title>{title}</title> : null}
      <g transform={`translate(${tx} ${ty}) scale(${m.scale})`} fill="currentColor">
        <path d={body} />
        <path d={ball} fill={jewel ? "var(--ball-3)" : "currentColor"} />
      </g>
      <path d={w.d} fill="currentColor" />
    </svg>
  );
}
