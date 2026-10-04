import type { CSSProperties } from "react";
import { WORDMARK, WORDMARK_CAP } from "./geometry";

type Master = keyof typeof WORDMARK;

interface WordmarkProps {
  /** Rendered cap height in px. Picks the optical master: below 22 px "text", below 40 px "mid", else "display". */
  capHeight?: number;
  master?: Master | "auto";
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export const masterFor = (cap: number): Master => (cap < 22 ? "text" : cap < 40 ? "mid" : "display");

/** UNISON, outlined from Bodoni Moda and hand-spaced (scripts/brand/wordmark.mjs). */
export function Wordmark({ capHeight = 18, master = "auto", title = "Unison", className, style }: WordmarkProps) {
  const m = master === "auto" ? masterFor(capHeight) : master;
  const w = WORDMARK[m];
  const height = w.bottom - w.top;
  const scale = capHeight / WORDMARK_CAP;
  return (
    <svg
      viewBox={`${w.left} ${w.top} ${w.width} ${height}`}
      width={w.width * scale}
      height={height * scale}
      role="img"
      aria-label={title}
      className={className}
      style={style}
    >
      <title>{title}</title>
      <path d={w.d} fill="currentColor" />
    </svg>
  );
}
