import type { RegimeName } from "@unison/engine";
import { bandLabel, REGIME_LABEL } from "@/lib/unison/regimeNow";

/** Regime chip: a glyph and a word, never colour alone. HALTED shows the stopped hand ("hacking seconds"). */
const TONE: Record<RegimeName, string> = {
  LIVE: "text-ink bg-ink/[0.06]",
  EXTENDED: "text-[oklch(0.5_0.12_300)] night:text-[oklch(0.8_0.09_300)] bg-[oklch(0.5_0.12_300/0.1)]",
  DISCOVERY: "text-accent bg-accent-soft",
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
  if (name === "DISCOVERY")
    return (
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
        <path d="M2 10 L6 2 L10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    );
  return <span aria-hidden className="size-1.5 rounded-full bg-current" />;
}

export function RegimeBadge({ name, bandBps, className = "" }: { name: RegimeName; bandBps?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[name]} ${className}`}>
      <Glyph name={name} />
      {REGIME_LABEL[name]}
      {bandBps !== undefined ? <span className="tnum font-normal">{bandLabel(bandBps)}</span> : null}
    </span>
  );
}
