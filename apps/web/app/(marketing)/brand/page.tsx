import type { Metadata } from "next";
import { Download } from "lucide-react";
import { PaletteClient, StrikeMarkClient } from "@/components/app/pages";
import { StaticEmblem } from "@/components/brand/StaticEmblem";
import { Lockup } from "@/components/brand/Lockup";
import { Wordmark } from "@/components/brand/Wordmark";

export const metadata: Metadata = {
  title: "Brand",
  description: "The Unison mark, wordmark, palette, type and motion, and every asset to download.",
};

const ASSETS: [string, string, string][] = [
  ["Mark, ink", "/brand/unison-mark-ink.svg", "SVG"],
  ["Mark, porcelain", "/brand/unison-mark-porcelain.svg", "SVG"],
  ["Mark, blued steel (day)", "/brand/unison-mark-ink-finished.svg", "SVG"],
  ["Mark, blued steel (night)", "/brand/unison-mark-porcelain-finished.svg", "SVG"],
  ["Mark, small master", "/brand/unison-mark-small-ink.svg", "SVG"],
  ["Mark, ink", "/brand/unison-mark-ink.png", "PNG"],
  ["Lockup, ink", "/brand/unison-lockup-ink.svg", "SVG"],
  ["Lockup, porcelain", "/brand/unison-lockup-porcelain.svg", "SVG"],
  ["Wordmark, ink", "/brand/unison-wordmark-ink.svg", "SVG"],
  ["Wordmark, porcelain", "/brand/unison-wordmark-porcelain.svg", "SVG"],
  ["App icon", "/brand/unison-app-icon.svg", "SVG"],
  ["App icon, 1024 px", "/brand/unison-app-icon-1024.png", "PNG"],
];

function Section({ id, title, lede, children }: { id: string; title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
      <div className="max-w-2xl">
        <h2 id={id} className="text-display-l text-ink">
          {title}
        </h2>
        {lede ? <p className="text-lede mt-5 text-ink-2">{lede}</p> : null}
      </div>
      <div className="mt-12">{children}</div>
    </section>
  );
}

export default function BrandPage() {
  return (
    <>
      <section className="mx-auto grid max-w-[1440px] items-center gap-12 px-5 pt-36 pb-12 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:px-12 lg:pt-44">
        <div>
          <h1 className="text-display-xl text-ink">The mark.</h1>
          <p className="text-lede mt-7 max-w-xl text-ink-2">
            A tuning fork is a U with a stem. An orchestra reaches unison by tuning to one reference pitch; Unison clears
            every order against one reference price. The tines are the buyers and the sellers. The ball is the one price
            they meet at.
          </p>
        </div>
        <StrikeMarkClient />
      </section>

      <Section id="masters-title" title="Three masters." lede="Drawn like a Didone letter and finished like a turned watch part, in three optical sizes, the way a dial's printing changes with its size.">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {[
            ["Display", "44 px and up", 96, "display"],
            ["Text", "20 to 44 px", 32, "mid"],
            ["Heavy", "16 to 20 px, on the pixel grid", 16, "small"],
          ].map(([name, range, size, master]) => (
            <figure key={name as string} className="flex flex-col items-center rounded-[var(--radius-xl)] bg-raised px-6 pt-10 pb-6 shadow-sm">
              <div className="grid h-28 place-items-center text-ink">
                <StaticEmblem size={size as number} master={master as "display" | "mid" | "small"} jewel />
              </div>
              <figcaption className="mt-6 text-center">
                <span className="block text-[15px] font-semibold text-ink">{name}</span>
                <span className="block text-sm text-ink-3">{range}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section id="lockup-title" title="One baseline." lede="Mark and wordmark set as one piece of type: the serifs on the cap line, the bowl on the baseline, the stem and ball hanging as a descender.">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="grid place-items-center rounded-[var(--radius-xl)] bg-raised px-8 py-16 shadow-sm">
            <div className="relative text-ink">
              <div aria-hidden className="pointer-events-none absolute -inset-6 rounded-md border border-dashed border-accent/50" />
              <Lockup capHeight={28} />
            </div>
            <p className="mt-10 text-sm text-ink-3">Clear space: one counter width on every side.</p>
          </div>
          <div className="grid place-items-center rounded-[var(--radius-xl)] bg-raised px-8 py-16 shadow-sm">
            <Wordmark capHeight={44} className="text-ink" />
            <p className="mt-10 text-sm text-ink-3">The wordmark: Bodoni Moda, outlined and spaced by hand.</p>
          </div>
        </div>
      </Section>

      <Section id="finish-title" title="The light follows the market." lede="Porcelain while Wall Street trades, Nocturne while it sleeps. The ball takes the light's own accent, flat and the same wherever the mark appears: blued steel by day, lifted for the black dial by night.">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <PaletteClient theme="day" name="Porcelain" note="Day: while the US market is open." />
          <PaletteClient theme="night" name="Nocturne" note="Night: nights, weekends and holidays." />
        </div>
      </Section>

      <Section id="type-title" title="Three voices." lede="A Didone for what deserves to be engraved, a grotesque for everything you read, a mono for what you verify.">
        <div className="space-y-5">
          <div className="rounded-[var(--radius-xl)] bg-raised p-8 shadow-sm">
            <p className="text-sm text-ink-3">Bodoni Moda · display, large numbers, never below 28 px</p>
            <p className="text-display-xl mt-4 text-ink">One price for everyone.</p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-[var(--radius-xl)] bg-raised p-8 shadow-sm">
              <p className="text-sm text-ink-3">Mona Sans · everything you read</p>
              <p className="mt-4 text-2xl font-semibold text-ink">Every order in a batch clears at one price.</p>
              <p className="tnum mt-3 text-ink-2">Tabular figures wherever a number moves: $180.27 · 12,000 batches an hour</p>
            </div>
            <div className="rounded-[var(--radius-xl)] bg-raised p-8 shadow-sm">
              <p className="text-sm text-ink-3">Fragment Mono · hashes and addresses only</p>
              <p className="mt-4 font-mono text-lg break-all text-ink">0x34b96dfc8be25f2e…c29f0</p>
              <p className="mt-3 text-ink-2">Truncated in the middle, so both ends can be checked.</p>
            </div>
          </div>
        </div>
      </Section>

      <Section id="motion-title" title="An escapement, not an animation." lede="The product moves the way a movement does: in beats, with nothing between them.">
        <ul className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
          {[
            ["Nothing moves between beats.", "The 300 ms batch is drawn as geometry, a sweep or a phase-lock, never as a flash."],
            ["The ball never moves.", "On a fill the tines flex in antiphase by at most a pixel and settle within three beats. The reference stays still."],
            ["Lume charges; it never pulses.", "Night glow follows traded volume, not a loop."],
            ["Reduced motion means none.", "Every motion has a static cue, and with reduced motion only the cue remains."],
          ].map(([t, d]) => (
            <li key={t}>
              <p className="text-[17px] font-semibold text-ink">{t}</p>
              <p className="mt-2 leading-relaxed text-ink-2">{d}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="downloads-title" title="Downloads." lede="Minimum size 16 px. Never stretch, outline, rotate or recolour the mark, and never set it on busy imagery. Call it the mark, or the tuning fork.">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ASSETS.map(([label, href, kind]) => (
            <li key={href}>
              <a href={href} download className="press flex items-center justify-between gap-4 rounded-2xl bg-raised px-5 py-4 shadow-sm transition-shadow hover-fine:shadow-md">
                <span>
                  <span className="block text-sm font-medium text-ink">{label}</span>
                  <span className="block text-xs text-ink-3">{kind}</span>
                </span>
                <Download size={16} strokeWidth={1.75} className="text-ink-3" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
