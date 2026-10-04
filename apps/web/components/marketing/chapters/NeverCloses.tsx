"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "@/components/motion/useInView";
import { facts } from "@/lib/content/facts";
import { marketByTicker } from "@/lib/content/markets";
import { site } from "@/lib/content/site";
import { regimeNow } from "@/lib/unison/regimeNow";

/**
 * Chapter 3: never closes. A 168-hour dial of the week: Wall Street's sessions engraved on the inner track, Unison's
 * unbroken ring outside, and a hand at this hour. Beside it, how the DISCOVERY band opens with √(time closed),
 * from NVDA's live parameters, with today's position marked when the market is shut.
 */
const HALF_HOURS = 336;
const nyParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function slotKind(slot: number): "regular" | "extended" | "closed" {
  const day = Math.floor(slot / 48);
  const h = (slot % 48) / 2;
  if (day >= 5) return "closed";
  if (h >= 9.5 && h < 16) return "regular";
  if ((h >= 4 && h < 9.5) || (h >= 16 && h < 20)) return "extended";
  return "closed";
}

/** Half-hour slot of the week in New York (Monday 00:00 = 0). */
function nowSlot(at: Date): number {
  const p = Object.fromEntries(nyParts.formatToParts(at).map((x) => [x.type, x.value]));
  const day = DAYS.indexOf(p.weekday ?? "Mon");
  return day * 48 + Number(p.hour) * 2 + (Number(p.minute) >= 30 ? 1 : 0) + (Number(p.minute) % 30) / 30;
}

const polar = (r: number, slot: number) => {
  const a = (slot / HALF_HOURS) * Math.PI * 2 - Math.PI / 2;
  // Rounded so server and client render byte-identical attributes.
  return [Math.round((300 + r * Math.cos(a)) * 100) / 100, Math.round((300 + r * Math.sin(a)) * 100) / 100] as const;
};
const arcPath = (r: number, from: number, to: number) => {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const large = to - from > HALF_HOURS / 2 ? 1 : 0;
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
};

export function NeverCloses() {
  const wrap = useRef<HTMLDivElement>(null);
  const shown = useInView(wrap, { threshold: 0.3 });
  const nvda = marketByTicker("aNVDA")!;
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Contiguous runs of the same session kind, for the inner track.
  const runs = useMemo(() => {
    const out: { kind: ReturnType<typeof slotKind>; from: number; to: number }[] = [];
    for (let s = 0; s < HALF_HOURS; s++) {
      const k = slotKind(s);
      const last = out.at(-1);
      if (last && last.kind === k) last.to = s + 1;
      else out.push({ kind: k, from: s, to: s + 1 });
    }
    return out;
  }, []);

  const slot = now ? nowSlot(now) : null;
  const regime = now ? regimeNow(nvda, now) : null;
  const hand = slot !== null ? polar(262, slot) : null;
  const handFrom = slot !== null ? polar(176, slot) : null;

  // Discovery band curve: max(floor, cap·√(t/H)), t in hours since the close.
  const H = nvda.regime.discHorizonSec / 3600;
  const cap = nvda.regime.discCapBps / 100;
  const floor = nvda.regime.discFloorBps / 100;
  const tMax = 60;
  const band = (t: number) => Math.max(floor, cap * Math.sqrt(Math.min(t, H) / H));
  const CW = 560;
  const CH = 300;
  const cx = (t: number) => 40 + (t / tMax) * (CW - 60);
  const cy = (pct: number) => CH - 40 - (pct / cap) * (CH - 70);
  const curve = Array.from({ length: 121 }, (_, i) => {
    const t = (i / 120) * tMax;
    return `${i === 0 ? "M" : "L"}${cx(t).toFixed(1)},${cy(band(t)).toFixed(1)}`;
  }).join("");
  const sinceClose = regime?.closedSince && now ? (now.getTime() - regime.closedSince.getTime()) / 3_600_000 : null;
  // the band at this moment as the venue computes it (the contract's integer math), not the curve's float
  const nowBand = regime ? regime.bandBps / 100 : 0;
  const marks = [
    { t: 0, label: "Close" },
    { t: 16, label: "Sat noon" },
    { t: 40, label: "Sun noon" },
    { t: 56, label: "Mon 4 a.m." },
  ];

  return (
    <section aria-labelledby="never-closes-title" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div ref={wrap} className="grid grid-cols-1 items-center gap-x-16 gap-y-14 lg:grid-cols-12">
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
                  strokeDashoffset: shown ? 0 : 1,
                  transition: "stroke-dashoffset 1400ms cubic-bezier(0.77,0,0.175,1) 900ms",
                  transform: "rotate(-90deg)",
                  transformOrigin: "300px 300px",
                }}
                className="motion-reduce:!transition-none"
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
                  style={{
                    strokeDashoffset: shown ? 0 : 1,
                    transition: `stroke-dashoffset 700ms cubic-bezier(0.23,1,0.32,1) ${(r.from / HALF_HOURS) * 800}ms`,
                  }}
                  className="motion-reduce:!transition-none"
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
              {/* Now */}
              {hand && handFrom ? (
                <g>
                  {/* the one moving hand, in blued steel */}
                  <line x1={handFrom[0]} y1={handFrom[1]} x2={hand[0]} y2={hand[1]} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
                  <circle cx={hand[0]} cy={hand[1]} r="3.5" fill="var(--accent)" />
                </g>
              ) : null}
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
              <path d={`${curve}L${cx(tMax)},${cy(0)}L${cx(0)},${cy(0)}Z`} fill="var(--champagne)" fillOpacity="0.14" />
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
              {sinceClose !== null && sinceClose <= tMax ? (
                <g>
                  <line x1={cx(sinceClose)} x2={cx(sinceClose)} y1={cy(0)} y2={cy(nowBand)} stroke="var(--ink)" strokeDasharray="2 4" />
                  <circle cx={cx(sinceClose)} cy={cy(nowBand)} r="5" fill="var(--accent)" />
                  {/* up and to the left of the dot, where the rising band never is (flipped only near the close);
                      a halo in the page color keeps grid hairlines off the figures */}
                  <text
                    x={cx(sinceClose) + (cx(sinceClose) > CW * 0.3 ? -12 : 12)}
                    y={cy(nowBand) - 24}
                    textAnchor={cx(sinceClose) > CW * 0.3 ? "end" : "start"}
                    className="tnum"
                    fill="var(--ink)"
                    stroke="var(--bg)"
                    strokeWidth={5}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    style={{ fontSize: 13, fontWeight: 600 }}
                  >
                    Now ±{nowBand.toFixed(2)}%
                  </text>
                </g>
              ) : null}
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
      </div>
    </section>
  );
}
