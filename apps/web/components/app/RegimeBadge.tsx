import type { RegimeName } from "@unison/engine";
import { facts } from "@/lib/content/facts";
import { bandLabel, REGIME_LABEL } from "@/lib/unison/regimeNow";

/** Regime chip: a glyph and a word, never colour alone. HALTED shows the stopped hand (a watch's stop-seconds). */
const TONE: Record<RegimeName, string> = {
  LIVE: "text-ink bg-ink/[0.06]",
  EXTENDED: "text-[oklch(0.5_0.12_300)] night:text-[oklch(0.8_0.09_300)] bg-[oklch(0.5_0.12_300/0.1)]",
  // the venue's night: an engraved champagne wash, ink text; blue is kept for the moving hand
  DISCOVERY: "text-ink bg-champagne/25",
  REOPENING: "text-[oklch(0.52_0.11_75)] night:text-[oklch(0.84_0.1_80)] bg-[oklch(0.6_0.12_75/0.12)]",
  HALTED: "text-halt bg-[repeating-linear-gradient(135deg,var(--sell-soft)_0_4px,transparent_4px_8px)]",
};

function Glyph({ name }: { name: RegimeName }) {
  if (name === "HALTED")
    return (
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <line x1="6" y1="6" x2="6" y2="2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="3.2" y1="3.2" x2="8.8" y2="8.8" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  // its market is closed: the crescent brokers use for after-hours trading, never a direction
  if (name === "DISCOVERY")
    return (
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
        <path d="M5.49 1.83 A4.2 4.2 0 1 0 9.98 7.33 A3.6 3.6 0 0 1 5.49 1.83 Z" fill="currentColor" />
      </svg>
    );
  return <span aria-hidden className="size-1.5 rounded-full bg-current" />;
}

/** What each regime means, in a sentence, for anyone who hovers the chip. */
const MEANS: Record<RegimeName, string> = {
  LIVE: "Its market is open: an auction every block, against a live reference.",
  EXTENDED: "Pre-market or after-hours: an auction every block, in a wider band.",
  DISCOVERY: `Its market is closed: a call auction every ${facts.discoveryBlocks} blocks, in a band around the last close that widens with time.`,
  REOPENING: "The first auction after the close: a wider band, so the opening price can be found.",
  HALTED: "Trading is paused, as it is on the primary market. Cancel, claim and withdraw still work.",
};

export function RegimeBadge({ name, bandBps, className = "" }: { name: RegimeName; bandBps?: number; className?: string }) {
  return (
    <span title={MEANS[name]} className={`inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 text-xs font-semibold ${TONE[name]} ${className}`}>
      <Glyph name={name} />
      {REGIME_LABEL[name]}
      {bandBps !== undefined ? <span className="tnum font-normal">{bandLabel(bandBps)}</span> : null}
    </span>
  );
}
