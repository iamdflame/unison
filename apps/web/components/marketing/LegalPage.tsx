import Link from "next/link";
import type { ReactNode } from "react";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

const PAGES = [
  ["/legal/terms", "Terms"],
  ["/legal/privacy", "Privacy"],
  ["/legal/risk", "Risk"],
] as const;

/**
 * A legal page set like a printed document: a measure you can read, a contents column that stays put, and the
 * one thing that must never be missed (this is a draft) above everything else.
 */
export function LegalPage({ path, title, updated, intro, sections }: { path: string; title: string; updated: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <div className="mx-auto max-w-[1440px] px-5 pt-36 pb-28 sm:px-8 lg:px-12 lg:pt-44">
      <nav aria-label="Legal" className="flex gap-1.5">
        {PAGES.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={href === path ? "page" : undefined}
            className={`press rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${href === path ? "bg-ink text-bg" : "bg-sunken text-ink-2 hover-fine:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <h1 className="text-display-xl mt-10 text-ink">{title}</h1>
      <p className="mt-4 text-sm text-ink-3">Updated {updated}</p>
      <p role="note" className="mt-8 max-w-3xl rounded-2xl border border-halt/40 bg-sell-soft/40 px-5 py-4 text-sm leading-relaxed text-ink">
        <span className="font-semibold">A draft, not yet reviewed by counsel.</span> Unison runs on test networks with
        mock assets today. These pages say plainly how it works and what can go wrong, and they will be reviewed before
        anything real is at stake.
      </p>
      <div className="text-lede mt-10 max-w-[68ch] text-ink-2">{intro}</div>

      <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Contents" className="hidden lg:block">
          <ol className="sticky top-28 space-y-2 text-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-baseline gap-2 text-ink-3 transition-colors hover-fine:text-ink">
                  {/* a hanging indent: a title that wraps stays under its title, not its number */}
                  <span className="figures min-w-[1.4em] shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span>{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="max-w-[68ch] space-y-12">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-28">
              <h2 id={`${s.id}-h`} className="text-[22px] font-semibold tracking-tight text-ink">
                <span className="figures mr-3 text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </h2>
              <div className="mt-4 space-y-4 leading-relaxed text-ink-2 [&_a]:text-ink [&_a]:underline [&_a]:decoration-line-strong [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-semibold [&_strong]:text-ink">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
