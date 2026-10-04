import { MARK_BOX, MARK_PARTS } from "@/components/brand/geometry";
import { facts } from "@/lib/content/facts";

/**
 * Chapter 6: Calibre U-300. The venue's specification, set like a watch catalogue's calibre page, beside a
 * technical drawing of the mark with its dimensions.
 */
const SPECS: [string, string, string?][] = [
  ["Frequency", `${facts.batchesPerHour.toLocaleString("en-US")} A/h · ${(facts.batchesPerHour / 3600).toFixed(2)} auctions a second`, `A/h, alternations an hour, is how a watchmaker counts beats; here each one is an auction. A batch every Monad block while Wall Street trades; a call auction every ${facts.discoveryBlocks} blocks (${(facts.batchesPerHour / facts.discoveryBlocks).toLocaleString("en-US")} A/h) while it is closed`],
  ["Power reserve", `${facts.hours.week} h a week`, "Every night and every weekend; a market stops only when its rules halt it"],
  ["Escapement", "Frequent batch auction", "Most volume, then least imbalance, then closest to the reference. Orders at that price share it pro rata"],
  ["Complications", "Discovery · Reopening cross · Halts · Audit", "Each with its own price band"],
  ["Fairness", "One price per batch", "Against a reference published after the batch closes"],
  ["Gas per clear", `${(facts.gas.clearMonad / 1e6).toFixed(2)}M`, `${facts.gas.savingPct}% less than under Ethereum's rules`],
  ["Cost", `≈ $${facts.gas.batch200Usd} per batch`, `200 orders; about $${facts.gas.orderUsd} per order`],
  ["Case", "Monad", "Testnet today, mainnet after an external audit. Open source, MIT"],
];

export function Calibre() {
  const body = MARK_PARTS.filter((p) => p.role === "body").map((p) => p.d).join(" ");
  const ball = MARK_PARTS.filter((p) => p.role !== "body").map((p) => p.d).join(" ");
  const b = MARK_BOX;
  return (
    <section aria-labelledby="calibre-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div className="grid grid-cols-1 gap-x-16 gap-y-14 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="text-sm text-ink-3">The specification</p>
          <h2 id="calibre-title" className="text-display-l mt-3 text-ink">
            Calibre U-300
          </h2>
          {/* Technical drawing of the mark, dimensioned on its 48-unit grid */}
          <svg viewBox="-6 -6 100 62" className="mt-10 h-auto w-full max-w-[520px]" role="img" aria-label="Technical drawing of the Unison mark.">
            <g fill="none" stroke="var(--ink)" strokeWidth="0.18">
              <path d={body} />
              <path d={ball} />
            </g>
            <g stroke="var(--ink-3)" strokeWidth="0.12" fill="none">
              <line x1={24} x2={24} y1={b.top - 4} y2={b.bottom + 3} strokeDasharray="1.2 0.8" />
              <circle cx={b.ball.cx} cy={b.ball.cy} r={b.ball.r + 1.6} strokeDasharray="0.6 0.6" />
              <line x1={b.ball.cx + b.ball.r + 1.6} x2={b.ball.cx + 14} y1={b.ball.cy} y2={b.ball.cy} />
              <line x1={24 + b.R + 1} x2={24 + b.R + 9} y1={b.yc} y2={b.yc} />
            </g>
            <g fill="var(--ink-2)" style={{ fontSize: 2.3, fontFamily: "var(--font-sans)", letterSpacing: "0.02em" }}>
                            <text x={b.ball.cx + 14.6} y={b.ball.cy + 0.7}>the ball: the one price</text>
              <text x={24 + b.R + 9.6} y={b.yc + 0.7}>the tines: buyers and sellers, joined</text>
            </g>
          </svg>
        </div>
        <dl className="lg:col-span-7 lg:pt-16">
          {SPECS.map(([k, v, note]) => (
            <div key={k} className="grid grid-cols-12 gap-x-6 border-t border-line py-6 last:border-b">
              <dt className="col-span-12 text-sm text-ink-3 sm:col-span-4">{k}</dt>
              <dd className="col-span-12 sm:col-span-8">
                <span className="numerals block text-[clamp(1.35rem,2vw,1.75rem)] leading-tight text-balance text-ink">
                  {/* a unit in Bodoni hairlines breaks up at this size: set it in the text face, smaller */}
                  {v.split(/( A\/h)/).map((part, i) =>
                    part === " A/h" ? (
                      <span key={i} className="font-sans text-[0.62em] font-medium tracking-wide text-ink-2">
                        {" "}A/h
                      </span>
                    ) : (
                      part
                    ),
                  )}
                </span>
                {note ? <span className="mt-1 block text-sm text-ink-2">{note}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
