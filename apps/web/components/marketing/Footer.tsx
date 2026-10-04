import Link from "next/link";
import { StaticEmblem } from "@/components/brand/StaticEmblem";
import { site } from "@/lib/content/site";

const COLUMNS = [
  { title: "Trade", links: [["Markets", "/markets"], ["Trade aNVDA", "/trade/aNVDA"], ["Vaults", "/vaults"], ["Portfolio", "/portfolio"]] },
  { title: "Proof", links: [["Fairness monitor", "/fairness"], ["Evidence", `${site.repo}/tree/main/docs/evidence`], ["Threat model", `${site.repo}/blob/main/docs/THREAT_MODEL.md`], ["Status", "/status"]] },
  { title: "Build", links: [["Developers", "/developers"], ["API", `${site.repo}/blob/main/docs/API.md`], ["Agents and MCP", `${site.repo}/blob/main/docs/AGENTS.md`], ["Source", site.repo]] },
  { title: "Unison", links: [["Brand", "/brand"], ["Terms", "/legal/terms"], ["Privacy", "/legal/privacy"], ["Risk", "/legal/risk"]] },
] as const;

/** The caseback: everything engraved, nothing loud. */
export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-[1440px] px-5 pt-20 pb-10 sm:px-8 lg:px-12">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4">
          {COLUMNS.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <p className="text-sm font-semibold text-ink">{c.title}</p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="text-sm text-ink-2 transition-colors duration-150 hover-fine:text-ink">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        {/* a colophon, as on a caseback: the mark and the calibre under one champagne rule, nothing louder */}
        <div className="mt-24 flex flex-col items-center gap-4 text-center">
          <span aria-hidden className="h-px w-[120px] bg-champagne" />
          <StaticEmblem size={28} jewel className="text-ink" />
          <p className="dial-label text-[11px] text-ink-3">Unison · Calibre U-300</p>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 text-xs text-ink-3">
          <p>Tokenized stocks on Monad. {site.disclosure}</p>
          <p>MIT licensed · Built for the Monad Metropolis hackathon</p>
        </div>
      </div>
    </footer>
  );
}
