"use client";

import NumberFlow from "@number-flow/react";
import { memo, useEffect, useRef, useState } from "react";
import { BEAT_MS } from "@/lib/motion/tokens";
import { createHeroFeed, type HeroFrame } from "@/lib/hero/feed";
import { whenIdle } from "@/lib/ui/lazy";
import type { MarketSpec } from "@/lib/content/markets";
import { bandLabel, REGIME_LABEL, regimeNow } from "@/lib/unison/regimeNow";
import { Emblem, type EmblemHandle } from "./Emblem";
import { MARK_BOX } from "./geometry";

/**
 * The hero instrument, built like a movement: one centre (the ball is the arbor), and nothing moves between beats.
 *
 *   beat (300 ms)  the pointer advances one step of a 200-step track (a minute per turn, 12,000 A/h) with a 40 ms
 *                  impulse, a dead stop and a hair of recoil: seconde morte, never a sweep
 *   orders         the engraved rings take a small dead-beat jump out of phase as orders arrive in a batch
 *   print          in a single impulse the rings fall into unison, the fork flexes (≤1 px) and settles within three
 *                  beats, the price is engraved in the 6 o'clock aperture, and the print lands on the band at 12
 *   lume (night)   the ball charges with traded volume and fades slowly; it never pulses
 */
const RINGS = 22;
const LOBES = 12;
const STEPS = 200; // pointer steps per revolution
const DEG_PER_PCT = 16; // band arc: ±1% of price = ±16°

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function cssColor(el: HTMLElement, varName: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  probe.style.display = "none";
  el.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

/** Polar arc on the 1000-unit dial, symmetric about 12 o'clock. */
const arc = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  const x1 = 500 - r * Math.sin(a);
  const y1 = 500 - r * Math.cos(a);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${deg > 90 ? 1 : 0} 1 ${(1000 - x1).toFixed(2)},${y1.toFixed(2)}`;
};

/**
 * Everything on the dial that doesn't move: the 200-step track, the signature, the band, the index and the
 * calibre text. It re-renders only when the band changes and nothing animates inside it, so the browser paints it
 * once; the pointer and the prints travel on their own composited layers above it.
 */
const DialFace = memo(function DialFace({ bandDeg }: { bandDeg: number }) {
  return (
    <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      <circle cx="500" cy="500" r="494" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      {/* 200-step track: one step per batch, a minute per turn */}
      <g stroke="var(--ink-3)">
        {Array.from({ length: STEPS }, (_, i) => (
          <line
            key={i}
            x1="500"
            y1={i % 10 === 0 ? 16 : 22}
            x2="500"
            y2="34"
            strokeWidth={i % 10 === 0 ? 1.8 : 0.8}
            strokeOpacity={i % 10 === 0 ? 0.85 : 0.45}
            transform={`rotate(${(i * 360) / STEPS} 500 500)`}
          />
        ))}
      </g>
      {/* Band at 12: the half-width the venue would use right now; prints land on it */}
      <path d={arc(442, bandDeg)} fill="none" stroke="var(--champagne)" strokeWidth="2" strokeLinecap="round" />
      <path d="M500,48 l-6,-10 h12 z" fill="var(--ink-2)" />
    </svg>
  );
});

/** Escapement impulse: reach the new position in 40 ms, recoil 1.5%, rest by 90 ms. */
function impulse(t: number): number {
  if (t <= 0) return 0;
  if (t < 40) return 1.015 * (1 - Math.pow(1 - t / 40, 2));
  if (t < 90) return 1.015 - 0.015 * ((t - 40) / 50);
  return 1;
}

export function ResonanceDial({ market, seed = 11, className }: { market: MarketSpec; seed?: number; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<HTMLDivElement>(null);
  const batchEl = useRef<HTMLSpanElement>(null);
  const printsLayer = useRef<HTMLDivElement>(null);
  const lume = useRef<HTMLDivElement>(null);
  const emblem = useRef<EmblemHandle>(null);
  const [regime, setRegime] = useState(() => regimeNow(market, new Date()));
  const auctionEvery = regime.name === "DISCOVERY" ? market.regime.discCadence : 1;
  const [feed] = useState(() => {
    const f = createHeroFeed({ seed, ref: Number(market.seedPrice) / 1e6 });
    // seeded, so the server and the browser run the same path and land on the same print
    for (let i = 0; i < 40 || (f.last === null && i < 400); i++) f.next(0, auctionEvery);
    return f;
  });
  const cadence = useRef(auctionEvery);
  const [price, setPrice] = useState(() => feed.last ?? Number(market.seedPrice) / 1e6);
  // where the beat comes from: the seeded feed for the first frames, then the venue's own market for the visit
  const [flow, setFlow] = useState<"seeded" | "simulation" | "live">("seeded");
  useEffect(() => {
    cadence.current = auctionEvery;
  }, [auctionEvery]);

  useEffect(() => {
    const id = setInterval(() => setRegime(regimeNow(market, new Date())), 60_000);
    return () => clearInterval(id);
  }, [market]);

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const still = reducedMotion();

    let size = 0;
    let dpr = 1;
    let stroke = cssColor(el, "--engrave");
    const noise = Array.from({ length: RINGS }, (_, i) => Math.sin(i * 12.9898 + 78.233) * 43758.5453 % 1);
    // Ring phases: `from` → `to` over one impulse. Unison = every ring at the same phase.
    const base = 0.4;
    let from = noise.map(() => base);
    let to = from.slice();
    let moveAt = -1;
    let raf = 0;
    let charge = 0; // lume, 0..1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = el.clientWidth;
      cv.width = Math.round(size * dpr);
      cv.height = Math.round(size * dpr);
      paint(1);
    };

    // The rings' angles never change, only their phases: tabulate the trigonometry once, and each ring costs two
    // sines (sin(Lθ + φ) = sin Lθ·cos φ + cos Lθ·sin φ) instead of 723.
    const N = 240;
    const cosT = new Float64Array(N + 1);
    const sinT = new Float64Array(N + 1);
    const sinL = new Float64Array(N + 1);
    const cosL = new Float64Array(N + 1);
    for (let s = 0; s <= N; s++) {
      const th = (s / N) * Math.PI * 2;
      cosT[s] = Math.cos(th);
      sinT[s] = Math.sin(th);
      sinL[s] = Math.sin(LOBES * th);
      cosL[s] = Math.cos(LOBES * th);
    }

    function paint(k: number) {
      const S = size * dpr;
      if (!S) return;
      const c = S / 2;
      ctx!.clearRect(0, 0, S, S);
      ctx!.lineWidth = 0.8 * dpr;
      ctx!.strokeStyle = stroke;
      const amp = 0.0075 * S;
      for (let i = 0; i < RINGS; i++) {
        const r = S * (0.14 + (0.25 * i) / (RINGS - 1));
        const phase = from[i]! + (to[i]! - from[i]!) * k;
        const cp = Math.cos(phase);
        const sp = Math.sin(phase);
        ctx!.globalAlpha = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / RINGS);
        ctx!.beginPath();
        for (let s = 0; s <= N; s++) {
          const rr = r + amp * (sinL[s]! * cp + cosL[s]! * sp);
          const x = c + rr * cosT[s]!;
          const y = c + rr * sinT[s]!;
          if (s === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
    }

    /** Runs one impulse to the new ring phases, then stops: between beats nothing is drawn. */
    function move(next: number[]) {
      from = from.map((f, i) => f + (to[i]! - f) * 1);
      to = next;
      if (still) {
        from = next.slice();
        paint(1);
        return;
      }
      moveAt = performance.now();
      cancelAnimationFrame(raf);
      const step = (now: number) => {
        const t = now - moveAt;
        paint(impulse(t));
        if (t < 90) raf = requestAnimationFrame(step);
        else from = to.slice();
      };
      raf = requestAnimationFrame(step);
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const mo = new MutationObserver(() => {
      stroke = cssColor(el, "--engrave");
      paint(1);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let lastAngle = 0;
    let swing: Animation | null = null;
    const onBeat = (f: HeroFrame) => {
      if (batchEl.current) batchEl.current.textContent = f.block.toLocaleString("en-US");
      // the venue's own regime and band, so the dial and the board never disagree
      const next = f.regime;
      if (next) setRegime((r) => (r.name === next.name && Math.abs(r.bandBps - next.bandBps) < 1 ? r : next));
      const g = pointer.current;
      if (g && !still) {
        const angle = (f.block % STEPS) * (360 / STEPS);
        // Unwrap so 359.1° → 0° steps forward instead of spinning back.
        const target = angle < lastAngle % 360 ? lastAngle + (360 - (lastAngle % 360)) + angle : lastAngle - (lastAngle % 360) + angle;
        swing?.cancel();
        g.style.transform = `rotate(${target}deg)`;
        swing = g.animate(
          [
            { transform: `rotate(${lastAngle}deg)` },
            { transform: `rotate(${target + 0.027}deg)`, offset: 0.44 },
            { transform: `rotate(${target}deg)` },
          ],
          { duration: 90, easing: "linear" },
        );
        lastAngle = target;
      }
      if (f.price !== null) {
        // A print: one impulse into unison, the fork flexes, the price is engraved, the lume charges.
        const lock = base + Math.random() * 0.0001;
        move(from.map(() => lock));
        setPrice(f.price);
        emblem.current?.strike(Math.min(1, 0.45 + f.volume / 25));
        plotPrint(f.price, f.ref);
        charge = Math.min(1, charge + f.volume / 60);
      } else if (f.orders > 0) {
        // Orders arriving: a small dead-beat jump out of phase, proportional to how many arrived.
        const spread = Math.min(1, f.orders / 8) * 0.3;
        // drift accumulates while an auction gathers, but never past ±0.6 rad of unison
        move(from.map((p, i) => base + Math.max(-0.6, Math.min(0.6, p - base + (noise[i]! - 0.5) * spread))));
      }
      charge *= 0.985;
      // the lume only shows at night; by day there is nothing to update
      // a thin edge of lume, never an orb
      if (lume.current && document.documentElement.dataset.theme === "night") lume.current.style.opacity = String(0.12 + charge * 0.4);
    };
    /** A print lands on the band at 12 and fades: an HTML layer, so its rotation and fade run on the compositor. */
    const plotPrint = (p: number, ref: number) => {
      const layer = printsLayer.current;
      if (!layer || still) return;
      const deg = Math.max(-150, Math.min(150, ((p - ref) / ref) * 100 * DEG_PER_PCT));
      const arm = document.createElement("div");
      arm.className = "absolute inset-0";
      arm.style.transform = `rotate(${deg.toFixed(2)}deg)`;
      const dot = document.createElement("span");
      dot.className = "absolute rounded-full bg-accent";
      // r 5 at (500, 58) on the 1000-unit dial
      Object.assign(dot.style, { width: "1cqw", height: "1cqw", left: "49.5cqw", top: "5.3cqw" });
      arm.appendChild(dot);
      layer.appendChild(arm);
      arm.animate([{ opacity: 1 }, { opacity: 1, offset: 0.1 }, { opacity: 0 }], { duration: 3000, easing: "ease-out" }).onfinish = () => arm.remove();
    };

    let timer = 0;
    let running = true;
    // Once the page is idle, the dial hands over to the venue: the market the terminal trades, live or simulated,
    // so this visit has one tape. Until then (and if that fails) the seeded feed keeps the beat.
    let source: { stop: () => void } | null = null;
    let alive = true;
    whenIdle(() => {
      import("@/lib/hero/source")
        .then(({ heroSource }) => heroSource(market, (f) => running && onBeat(f)))
        .then((s) => {
          if (!alive) return s.stop();
          source = s;
          clearTimeout(timer);
          if (s.last !== null) setPrice(s.last);
          setFlow(s.live ? "live" : "simulation");
        })
        .catch(() => undefined);
    });
    const tick = () => {
      if (source) return;
      if (running) onBeat(feed.next(Date.now(), cadence.current));
      timer = window.setTimeout(tick, BEAT_MS);
    };
    const io = new IntersectionObserver(([e]) => {
      running = !!e?.isIntersecting && document.visibilityState === "visible";
    });
    io.observe(el);
    const onVis = () => {
      running = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);
    tick();
    return () => {
      alive = false;
      source?.stop();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [feed, market]);

  // The fork stands at 12 with its ball on the arbor: the reference everyone tunes to.
  const ballCy = MARK_BOX.ball?.cy ?? MARK_BOX.bottom;
  const forkReach = 0.28; // tine tops at 28% of the dial's width above the arbor: the fork signs the dial, it isn't the dial
  const emblemPct = (forkReach * 48) / (ballCy - MARK_BOX.top);
  const bandDeg = Math.min(150, (regime.bandBps / 100) * DEG_PER_PCT);

  return (
    <div
      ref={wrap}
      // its own layer: what changes on a beat (the aperture, the batch number, the lume) repaints the dial, not the page
      className={`relative aspect-square w-full select-none [container-type:inline-size] [will-change:transform] ${className ?? ""}`}
      role="img"
      aria-label={`${market.ticker} on Unison: one price every batch. ${REGIME_LABEL[regime.name]}, band ${bandLabel(regime.bandBps)}. ${flow === "live" ? "Live" : "Simulated"} order flow.`}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      <DialFace bandDeg={bandDeg} />
      {/* Prints and the pointer move on their own layers, so a beat never repaints the face beneath them */}
      <div ref={printsLayer} className="pointer-events-none absolute inset-0" aria-hidden />
      <div ref={pointer} className="pointer-events-none absolute inset-0" aria-hidden>
        <svg viewBox="0 0 1000 1000" className="h-full w-full overflow-visible">
          <path d="M500,40 l-5.5,-17 h11 z" fill="var(--accent)" />
        </svg>
      </div>
      {/* Lume: the ball charges with traded volume (night only) */}
      <div
        ref={lume}
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full night:block"
        style={{ width: "3.2cqw", height: "3.2cqw", background: "radial-gradient(closest-side, var(--glow), transparent)", opacity: 0.15, transition: "opacity 600ms linear" }}
      />
      <div
        className="absolute"
        style={{
          width: `${emblemPct * 100}cqw`,
          height: `${emblemPct * 100}cqw`,
          left: `calc(50cqw - ${(24 / 48) * emblemPct * 100}cqw)`,
          top: `calc(50cqw - ${(ballCy / 48) * emblemPct * 100}cqw)`,
        }}
      >
        <Emblem ref={emblem} size={0} master="display" jewel style={{ width: "100%", height: "100%" }} />
      </div>
      {/* Engraved specification, like a calibre's dial text: the cadence this market keeps right now */}
      <p className="dial-label absolute inset-x-0 text-center text-ink-3" style={{ top: "59.6cqw", fontSize: "max(10px, 1.3cqw)" }} aria-hidden>
        {(12_000 / auctionEvery).toLocaleString("en-US")} A/h · {regime.name === "DISCOVERY" ? "Discovery" : "Monad"}
      </p>
      {/* The 6 o'clock aperture: the price everyone in this batch got */}
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: "66.5cqw" }}>
        {/* an aperture cut into the dial: a sunken window, lit from above, edged in one champagne hairline */}
        <div className="flex flex-col items-center rounded-[0.8cqw] bg-sunken px-[3.2cqw] py-[1.6cqw] shadow-[inset_0_1px_2px_oklch(0_0_0/0.18)] ring-1 ring-champagne/60">
          <div className="numerals leading-none" style={{ fontSize: "6.2cqw" }}>
            <NumberFlow
              value={price}
              locales="en-US"
              format={{ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              transformTiming={{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
              spinTiming={{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
              opacityTiming={{ duration: 150, easing: "ease-out" }}
            />
          </div>
          <p className="dial-label mt-[1.2cqw] text-ink-2" style={{ fontSize: "max(11px, 1.35cqw)" }}>
            <span className="normal-case tracking-[0.04em]">{market.ticker}</span> · {REGIME_LABEL[regime.name]} {bandLabel(regime.bandBps)}
          </p>
        </div>
        <p className="tnum mt-[1.4cqw] text-center text-ink-3" style={{ fontSize: "max(11px, 1.4cqw)" }}>
          Block <span ref={batchEl}>—</span> · {flow === "live" ? "live" : "simulation"}
        </p>
      </div>
    </div>
  );
}
