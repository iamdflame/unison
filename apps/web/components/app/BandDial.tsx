import type { RegimeName } from "@unison/engine";

/**
 * A market's band as a small dial: the reference at twelve o'clock, the band its next auction may clear in drawn
 * as a champagne arc around it, and the hand on the last clear inside that band. The arc opens with the band, so
 * discovery reads at a glance; a halted market shows no arc and a stopped, crossed hand.
 */
export function BandDial({
  bandBps,
  regime,
  needle = 0,
  className = "size-16",
}: {
  bandBps: number | null;
  regime?: RegimeName;
  /** where the last clear sat inside the band: -1 (low edge) to 1 (high edge); the hand points there */
  needle?: number;
  className?: string;
}) {
  const halted = regime === "HALTED";
  const pct = bandBps === null ? 1 : bandBps / 100;
  const deg = Math.min(150, Math.max(4, pct * 16));
  const a = (deg * Math.PI) / 180;
  const r = 40;
  const x1 = 50 - r * Math.sin(a);
  const y1 = 50 - r * Math.cos(a);
  return (
    <svg viewBox="0 0 100 100" className={`shrink-0 ${className}`} aria-hidden>
      <circle cx="50" cy="50" r="46" fill="none" stroke="var(--line)" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1="6" x2="50" y2={i % 3 === 0 ? 12 : 9} stroke="var(--ink-3)" strokeWidth="1" transform={`rotate(${i * 30} 50 50)`} />
      ))}
      {!halted && bandBps !== null ? (
        <path
          d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${deg > 90 ? 1 : 0} 1 ${(100 - x1).toFixed(2)},${y1.toFixed(2)}`}
          fill="none"
          stroke="var(--champagne)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      ) : null}
      <circle cx="50" cy="50" r="5" fill={halted ? "var(--halt)" : "var(--ball-3)"} />
      <line
        x1="50"
        y1="45"
        x2="50"
        y2="18"
        stroke={halted ? "var(--halt)" : "var(--ink)"}
        strokeWidth="2"
        strokeLinecap="round"
        transform={`rotate(${halted ? 0 : (Math.max(-1, Math.min(1, needle)) * deg).toFixed(2)} 50 50)`}
        style={{ transition: "transform 240ms cubic-bezier(0.23, 1, 0.32, 1)" }}
      />
      {halted ? <line x1="30" y1="30" x2="70" y2="70" stroke="var(--halt)" strokeWidth="1.5" strokeLinecap="round" /> : null}
    </svg>
  );
}
