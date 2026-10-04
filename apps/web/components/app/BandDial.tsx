import type { RegimeName } from "@unison/engine";

/**
 * A market's band as a small dial: the reference engraved at twelve o'clock, the band its next auction may clear in
 * drawn as a champagne arc around it, and the last trade as a bead set on that arc. No hand: the arc's width is the
 * reading (a live market's ±1% is a sliver, a weekend's discovery band opens wide) and the bead sits where the price
 * really is, which most of the time is right beside the reference. A halted market shows no arc, only the stop.
 */
export function BandDial({
  bandBps,
  regime,
  needle = 0,
  className = "size-16",
}: {
  bandBps: number | null;
  regime?: RegimeName;
  /** where the last trade sat inside the band: -1 (low edge) to 1 (high edge); the bead is set there */
  needle?: number;
  className?: string;
}) {
  const halted = regime === "HALTED";
  const pct = bandBps === null ? 1 : bandBps / 100;
  const deg = Math.min(150, Math.max(6, pct * 16));
  const r = 38;
  const at = (d: number) => {
    const a = (d * Math.PI) / 180;
    return [50 + r * Math.sin(a), 50 - r * Math.cos(a)] as const;
  };
  const [x1, y1] = at(-deg);
  const [x2, y2] = at(deg);
  const [bx, by] = at(Math.max(-1, Math.min(1, needle)) * deg);
  const banded = !halted && bandBps !== null;
  return (
    <svg viewBox="0 0 100 100" className={`shrink-0 ${className}`} aria-hidden>
      <circle cx="50" cy="50" r="47" fill="none" stroke="var(--line)" />
      {[90, 180, 270].map((d) => (
        <line key={d} x1="50" y1="3" x2="50" y2="9" stroke="var(--ink-3)" strokeWidth="1" transform={`rotate(${d} 50 50)`} />
      ))}
      {banded ? (
        <path
          d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${deg > 90 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`}
          fill="none"
          stroke="var(--champagne)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      ) : null}
      {/* the reference, engraved at twelve: what the band is centred on */}
      <line x1="50" y1="0.5" x2="50" y2="6.5" stroke={halted ? "var(--halt)" : "var(--ink)"} strokeWidth="2.5" strokeLinecap="round" />
      {banded ? (
        <circle cx={bx.toFixed(2)} cy={by.toFixed(2)} r="5.5" fill="var(--ball)" stroke="var(--bg-raised)" strokeWidth="1.5" />
      ) : null}
      {halted ? (
        <>
          <circle cx="50" cy="50" r="5" fill="var(--halt)" />
          <line x1="32" y1="32" x2="68" y2="68" stroke="var(--halt)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}
