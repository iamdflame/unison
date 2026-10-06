import { facts } from "@/lib/content/facts";
import { marketByTicker } from "@/lib/content/markets";
import { site } from "@/lib/content/site";
import { arcPath, bandChart, CH, CW, DAYS, HALF_HOURS, polar, slotKind, T_MAX } from "./neverClosesGeometry";
import { BandNow, Reveal, WeekHand } from "./NeverClosesLive";

/**
 * Chapter 3: never closes. A 168-hour dial of the week: Wall Street's sessions engraved on the inner track, Unison's
 * unbroken ring outside, and a hand at this hour. Beside it, how the DISCOVERY band opens with √(time closed),
 * from NVDA's live parameters, with today's position marked when the market is shut. Drawn on the server; the hand,
 * today's mark and the moment it draws itself are the browser's.
 */

// A stroke drawn on when the chapter comes into view (Reveal sets data-shown on the group).
const DRAW = "[stroke-dashoffset:1] group-data-[shown]:[stroke-dashoffset:0] motion-reduce:!transition-none";

export function NeverCloses() {
  const nvda = marketByTicker("aNVDA")!;

  // Contiguous runs of the same session kind, for the inner track.
  const runs: { kind: ReturnType<typeof slotKind>; from: number; to: number }[] = [];
  for (let s = 0; s < HALF_HOURS; s++) {
    const k = slotKind(s);
    const last = runs.at(-1);
    if (last && last.kind === k) last.to = s + 1;
    else runs.push({ kind: k, from: s, to: s + 1 });
  }

  const { cap, floor, band, cx, cy } = bandChart(nvda);
  const curve = Array.from({ length: 121 }, (_, i) => {
    const t = (i / 120) * T_MAX;
    return `${i === 0 ? "M" : "L"}${cx(t).toFixed(1)},${cy(band(t)).toFixed(1)}`;
  }).join("");
  const marks = [
    { t: 0, label: "Close" },
    { t: 16, label: "Sat noon" },
    { t: 40, label: "Sun noon" },
    { t: 56, label: "Mon 4 a.m." },
  ];

  return (
    <section aria-labelledby="never-closes-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <Reveal className="group grid grid-cols-1 items-center gap-x-16 gap-y-14 lg:grid-cols-12">
        <div className="order-2 lg:order-1 lg:col-span-6">
          <figure className="mx-auto max-w-[560px]">
            <svg viewBox="0 0 600 600" className="h-auto w-full" role="img" aria-label={`A week is ${facts.hours.week} hours. Wall Street trades ${facts.hours.regularPerWeek} of them; Unison trades all ${facts.hours.week}.`}>
              {/* Unison: the chapter ring, a double rule in champagne, unbroken all week */}
              <circle cx="300" cy="300" r="256" fill="none" stroke="var(--champagne)" strokeWidth="0.75" />
              <circle
                cx="300"
                cy="300"
                r="248"
                fill="none"
                stroke="var(--champagne)"
                strokeWidth="2.5"
                pathLength={1}
                strokeDasharray="1"
                style={{
                  transition: "stroke-dashoffset 1400ms cubic-bezier(0.77,0,0.175,1) 900ms",
                  transform: "rotate(-90deg)",
                  transformOrigin: "300px 300px",
                }}
                className={DRAW}
              />
              {/* 168 hour graduations, longer every six hours, like a power reserve's scale */}
              {Array.from({ length: facts.hours.week }, (_, h) => {
                const [x1, y1] = polar(h % 6 === 0 ? 226 : 232, h * 2);
                const [x2, y2] = polar(240, h * 2);
                return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-3)" strokeWidth={h % 6 === 0 ? 0.9 : 0.5} strokeOpacity={h % 6 === 0 ? 0.8 : 0.5} />;
              })}
              {/* Wall Street: its sessions engraved on a hairline track; the hours it is shut are simply bare */}
              <circle cx="300" cy="300" r="206" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
              {runs.filter((r) => r.kind !== "closed").map((r) => (
                <path
                  key={r.from}
                  d={arcPath(206, r.from, r.to)}
                  fill="none"
                  stroke="var(--ink)"
                  strokeOpacity={r.kind === "extended" ? 0.3 : 1}
                  strokeWidth={10}
                  pathLength={1}
                  strokeDasharray="1"
                  style={{ transition: `stroke-dashoffset 700ms cubic-bezier(0.23,1,0.32,1) ${(r.from / HALF_HOURS) * 800}ms` }}
                  className={DRAW}
                />
              ))}
              {/* Day ticks and names */}
              {DAYS.map((d, i) => {
                const [tx, ty] = polar(290, i * 48 + 24);
                const [x1, y1] = polar(226, i * 48);
                const [x2, y2] = polar(186, i * 48);
                return (
                  <g key={d}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--line-strong)" strokeWidth="1" />
                    <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" className="dial-label" fill="var(--ink-3)" style={{ fontSize: 12 }}>
                      {d.toUpperCase()}
                    </text>
                  </g>
                );
              })}
              <WeekHand />
              <text x="300" y="282" textAnchor="middle" className="font-display" fill="var(--ink)" style={{ fontSize: 76, fontVariationSettings: '"opsz" 72' }}>
                {facts.hours.week}
              </text>
              <text x="300" y="322" textAnchor="middle" className="dial-label" fill="var(--ink-3)" style={{ fontSize: 12 }}>
                HOURS A WEEK
              </text>
            </svg>
            <figcaption className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink-3">
              <span className="inline-flex items-center gap-2"><span aria-hidden className="h-1.5 w-5 rounded-full bg-ink" /> Wall Street, {facts.hours.regularPerWeek} h</span>
              <span className="inline-flex items-center gap-2"><span aria-hidden className="h-1.5 w-5 rounded-full bg-ink/30" /> Extended hours</span>
              <span className="inline-flex items-center gap-2"><span aria-hidden className="h-0.5 w-5 rounded-full bg-champagne" /> Unison, all {facts.hours.week}</span>
              <span className="inline-flex items-center gap-2"><span aria-hidden className="h-0.5 w-5 rounded-full bg-accent" /> Now</span>
            </figcaption>
          </figure>
        </div>

        <div className="order-1 lg:order-2 lg:col-span-6">
          <h2 id="never-closes-title" className="text-display-l text-ink">
            Open every night
            <br />
            and every weekend.
          </h2>
          <p className="text-lede mt-6 max-w-xl text-ink-2">
            Wall Street trades {facts.hours.regularPerWeek} of the week&apos;s {facts.hours.week} hours. When it closes,
            Unison keeps pricing in a call auction every {nvda.regime.discCadence} blocks (about{" "}
            {((nvda.regime.discCadence * facts.beatMs) / 1000).toFixed(0)}&nbsp;seconds), inside a band that opens the longer the market has been shut.
          </p>

          <figure className="mt-10">
            <svg viewBox={`0 0 ${CW} ${CH}`} className="h-auto w-full max-w-[560px]" role="img" aria-label={`NVDA's discovery band widens from ±${floor.toFixed(2)}% at the close toward ±${cap.toFixed(2)}%.`}>
              {[floor, cap / 2, cap].map((p) => (
                <g key={p}>
                  <line x1="40" x2={CW - 20} y1={cy(p)} y2={cy(p)} stroke="var(--line)" />
                  <text x="34" y={cy(p)} textAnchor="end" dominantBaseline="middle" className="tnum" fill="var(--ink-3)" style={{ fontSize: 12 }}>
                    ±{p.toFixed(1)}%
                  </text>
                </g>
              ))}
              {/* the band as an engraved curve over a champagne wash; only "now" is in blued steel */}
              <path d={`${curve}L${cx(T_MAX)},${cy(0)}L${cx(0)},${cy(0)}Z`} fill="var(--champagne)" fillOpacity="0.14" />
              <path d={curve} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
              <line x1="40" x2={CW - 20} y1={cy(0)} y2={cy(0)} stroke="var(--line-strong)" />
              {marks.map((m) => (
                <g key={m.label}>
                  <line x1={cx(m.t)} x2={cx(m.t)} y1={cy(0)} y2={cy(0) + 6} stroke="var(--ink-3)" />
                  <text x={cx(m.t)} y={cy(0) + 24} textAnchor={m.t === 0 ? "start" : "middle"} fill="var(--ink-3)" style={{ fontSize: 12 }}>
                    {m.label}
                  </text>
                </g>
              ))}
              <BandNow />
            </svg>
            <figcaption className="mt-4 max-w-xl text-sm leading-relaxed text-ink-3">
              NVDA&apos;s discovery band, from its live parameters. Over five years NVDA opened more than{" "}
              {facts.weekend.gapThresholdPct}% away from Friday&apos;s close on {facts.weekend.nvdaMondaysGappedPct}% of
              weekends, and MSTR on {facts.weekend.mstrMondaysGappedPct}%.{" "}
              <a className="underline decoration-line-strong underline-offset-4 hover-fine:text-ink" href={`${site.repo}/blob/main/docs/evidence/weekend-gaps.md`}>
                The study
              </a>
            </figcaption>
          </figure>
        </div>
      </Reveal>
    </section>
  );
}
