import type { CSSProperties } from "react";
import { MARK_MID_PARTS, MARK_PARTS, MARK_SMALL_PARTS } from "./geometry";
import { masterForSize, type Master } from "./master";

/**
 * The mark where it holds still (navigation bars, headers). It has no hooks, so a server component draws it and the
 * page carries its path data as markup rather than JavaScript; the animated `Emblem` is for the places it strikes.
 */
export function StaticEmblem({
  size = 28,
  master = "auto",
  jewel = false,
  title,
  className,
  style,
}: {
  size?: number;
  master?: "auto" | Master;
  /** Finish the ball: blued steel by day, lume by night. Off = monochrome. */
  jewel?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const m = master === "auto" ? masterForSize(size) : master;
  const parts = m === "small" ? MARK_SMALL_PARTS : m === "mid" ? MARK_MID_PARTS : MARK_PARTS;
  const body = parts.filter((p) => p.role === "body").map((p) => p.d).join(" ");
  const ball = parts.filter((p) => p.role !== "body").map((p) => p.d).join(" ");
  // one definition per master; every copy on a page is identical, so sharing the id is safe
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      style={{ overflow: "visible", ...style }}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <g fill="currentColor">
        <path d={body} />
        <path d={ball} fill={jewel ? "var(--ball)" : "currentColor"} />
      </g>
    </svg>
  );
}
