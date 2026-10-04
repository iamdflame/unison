import type { Metadata } from "next";
import { marketMoment, heroLine } from "@/lib/time/market";
import { statusName } from "@unison/sdk";

export const metadata: Metadata = { title: "Lab", robots: { index: false, follow: false } };

/** Internal gallery: every token, type style and component in every state (W3 grows this page). */
export default function Lab() {
  const m = marketMoment();
  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-24">
      <p className="dial-label text-ink-3">Batch · Band · Regime</p>
      <h1 className="text-display-xxl mt-6">The market that never closes.</h1>
      <p className="text-lede mt-6 max-w-xl text-ink-2">{heroLine(m)}</p>
      <p className="tnum mt-4 font-mono text-sm text-ink-3">
        session {statusName(m.status)} · phase {m.phase} · next change {m.nextChange.toISOString()}
      </p>
      <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {["bg", "raised", "sunken", "ink", "ink-2", "ink-3", "accent", "buy", "sell", "halt", "champagne", "line-strong"].map((c) => (
          <div key={c} className="rounded-lg hairline bg-raised p-3 shadow-sm">
            <div className="h-12 rounded-sm" style={{ background: `var(--color-${c})` }} />
            <p className="mt-2 text-xs text-ink-2">{c}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
