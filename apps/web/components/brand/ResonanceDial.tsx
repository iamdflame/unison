"use client";

import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";
import { BEAT_MS } from "@/lib/motion/tokens";
import { createHeroFeed, type HeroFrame } from "@/lib/hero/feed";
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
  const pointer = useRef<SVGGElement>(null);
  const batchEl = useRef<HTMLSpanElement>(null);
  const printsLayer = useRef<SVGGElement>(null);
  const lume = useRef<HTMLDivElement>(null);
  const emblem = useRef<EmblemHandle>(null);
  const [price, setPrice] = useState(() => Number(market.seedPrice) / 1e6);
  const [regime, setRegime] = useState(() => regimeNow(market, new Date()));

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
    let from = noise.map((n) => base + n * 2.2);
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
        ctx!.globalAlpha = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / RINGS);
        ctx!.beginPath();
        for (let s = 0; s <= 240; s++) {
          const th = (s / 240) * Math.PI * 2;
          const rr = r + amp * Math.sin(LOBES * th + phase);
          const x = c + rr * Math.cos(th);
          const y = c + rr * Math.sin(th);
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

    const feed = createHeroFeed({ seed, ref: Number(market.seedPrice) / 1e6 });
    let lastAngle = 0;
    let swing: Animation | null = null;
    const onBeat = (f: HeroFrame) => {
      if (batchEl.current) batchEl.current.textContent = f.block.toLocaleString("en-US");
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
        const spread = Math.min(1, f.orders / 8) * 0.9;
        move(from.map((p, i) => p + (noise[i]! - 0.5) * spread));
      }
      charge *= 0.985;
      if (lume.current) lume.current.style.opacity = String(0.15 + charge * 0.85);
    };
    const plotPrint = (p: number, ref: number) => {
      const layer = printsLayer.current;
      if (!layer || still) return;
      const deg = Math.max(-150, Math.min(150, ((p - ref) / ref) * 100 * DEG_PER_PCT));
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("r", "5");
      dot.setAttribute("cx", "500");
      dot.setAttribute("cy", String(500 - 442));
      dot.setAttribute("transform", `rotate(${deg.toFixed(2)} 500 500)`);
      dot.setAttribute("fill", "var(--accent)");
      layer.appendChild(dot);
      dot.animate([{ opacity: 1 }, { opacity: 1, offset: 0.1 }, { opacity: 0 }], { duration: 3000, easing: "ease-out" }).onfinish = () =>
        dot.remove();
    };

    let timer = 0;
    let running = true;
    const tick = () => {
      if (running) onBeat(feed.next(Date.now()));
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
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [seed, market]);

  // The fork stands at 12 with its ball on the arbor: the reference everyone tunes to.
  const ballCy = MARK_BOX.ball?.cy ?? MARK_BOX.bottom;
  const forkReach = 0.355; // tine tops at 35.5% of the dial's width above the arbor
  const emblemPct = (forkReach * 48) / (ballCy - MARK_BOX.top);
  const bandDeg = Math.min(150, (regime.bandBps / 100) * DEG_PER_PCT);
  const arc = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    const x1 = 500 - r * Math.sin(a);
    const y1 = 500 - r * Math.cos(a);
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${deg > 90 ? 1 : 0} 1 ${(1000 - x1).toFixed(2)},${y1.toFixed(2)}`;
  };
  // Rehaut engraving, as on a fine case: the name, repeated, evenly around the dial.
  const rehaut = Array.from({ length: 12 }, () => "UNISON").join("  ◆  ") + "  ◆  ";

  return (
    <div
      ref={wrap}
      className={`relative aspect-square w-full select-none [container-type:inline-size] ${className ?? ""}`}
      role="img"
      aria-label={`${market.ticker} on Unison: one price every batch. ${REGIME_LABEL[regime.name]}, band ${bandLabel(regime.bandBps)}. Simulated order flow.`}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <path id="rehaut" d="M500,500 m-402,0 a402,402 0 1,1 804,0 a402,402 0 1,1 -804,0" />
        </defs>
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
        <text className="dial-label" fill="var(--ink-3)" style={{ fontSize: 11, letterSpacing: "0.32em" }} opacity="0.75">
          <textPath href="#rehaut" textLength={2 * Math.PI * 402 - 18} lengthAdjust="spacing">
            {rehaut}
          </textPath>
        </text>
        {/* Band at 12: the half-width the venue would use right now; prints land on it */}
        <path d={arc(442, bandDeg)} fill="none" stroke="var(--champagne)" strokeWidth="2" strokeLinecap="round" />
        <path d="M500,48 l-6,-10 h12 z" fill="var(--ink-2)" />
        <g ref={printsLayer} />
        <g ref={pointer} style={{ transformOrigin: "500px 500px", transformBox: "view-box" }}>
          <path d="M500,40 l-5.5,-17 h11 z" fill="var(--accent)" />
        </g>
        {/* Engraved specification, like a calibre's dial text */}
        <text x="500" y="610" textAnchor="middle" className="dial-label" fill="var(--ink-3)" style={{ fontSize: 13, letterSpacing: "0.2em" }}>
          12,000 A/H · MONAD
        </text>
      </svg>
      {/* Lume: the ball charges with traded volume (night only) */}
      <div
        ref={lume}
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full night:block"
        style={{ width: "4.6cqw", height: "4.6cqw", background: "radial-gradient(closest-side, var(--glow), transparent)", opacity: 0.15, transition: "opacity 600ms linear" }}
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
      {/* The 6 o'clock aperture: the price everyone in this batch got */}
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: "66.5cqw" }}>
        <div className="glass flex flex-col items-center rounded-[2.4cqw] px-[3.2cqw] py-[1.6cqw] shadow-sm hairline">
          <div className="font-display tnum leading-none" style={{ fontSize: "6.2cqw", fontVariationSettings: '"opsz" 72' }}>
            <NumberFlow
              value={price}
              locales="en-US"
              format={{ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              transformTiming={{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
              spinTiming={{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
              opacityTiming={{ duration: 150, easing: "ease-out" }}
            />
          </div>
          <p className="dial-label mt-[1.2cqw] text-ink-2" style={{ fontSize: "1.35cqw" }}>
            <span className="normal-case tracking-[0.04em]">{market.ticker}</span> · {REGIME_LABEL[regime.name]} {bandLabel(regime.bandBps)}
          </p>
        </div>
        <p className="tnum mt-[1.4cqw] text-center text-ink-3" style={{ fontSize: "1.4cqw" }}>
          Batch <span ref={batchEl}>—</span> · simulated flow
        </p>
      </div>
    </div>
  );
}
