"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { causalWait } from "@/lib/content/facts";
import { marketByTicker } from "@/lib/content/markets";
import { demoMarket, PAPER_QUOTE } from "@/lib/demo/engine";
import { BEAT_MS } from "@/lib/motion/tokens";
import { useStore } from "@/lib/store/createStore";
import { endTour, goToStep, tour } from "@/lib/ui/tour";
import { useVenue } from "@/lib/venue";
import { networkName } from "@/lib/venue/config";
import { identity } from "@/lib/venue/identity";
import { liveMarket } from "@/lib/venue/live";
import { dockCard, lightAround, PAD, placeCard, type Rect } from "./placement";
import { stepsFor, type TourAnchor, type TourContext } from "./steps";

/** how long the light takes to glide from one part of the terminal to the next */
const GLIDE_MS = 420;
// ease-out quart: the house curve, cubic-bezier(0.23, 1, 0.32, 1), closely enough for a glide written frame by frame
const ease = (t: number) => 1 - (1 - t) ** 4;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const noop = () => () => {};

function useMedia(query: string, server: boolean) {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => server);
}

/** The first element marked with this anchor that is laid out: the ticket column is marked but not shown on a phone. */
function findAnchor(a: TourAnchor): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${a}"]`)) if (el.getClientRects().length > 0) return el;
  return null;
}

type Frame = { light: Rect; radius: number; card: { x: number; y: number } };

/**
 * The light and the card, moved frame by frame. Each frame measures the lit element where it is now, so a glide that
 * starts while the page scrolls to it still lands on it; after the glide, scrolling, resizing and live figures that
 * change an element's size, or move it by changing what sits above it, move the light with it, at once.
 */
class Spotlight {
  compact = false;
  reduce = false;
  private el: HTMLElement | null = null;
  /** the light's corner: the lit element's own, plus the padding around it, so the two curves are concentric */
  private radius = 12;
  private cur: Frame | null = null;
  private from: Frame | null = null;
  private start = 0;
  private raf = 0;
  private sizes: ResizeObserver;

  constructor(
    private root: RefObject<HTMLDivElement | null>,
    private hole: RefObject<HTMLDivElement | null>,
    private card: RefObject<HTMLDivElement | null>,
  ) {
    this.sizes = new ResizeObserver(this.schedule);
    if (card.current) this.sizes.observe(card.current);
  }

  /** Lights an element (or nothing: the card alone, centred), gliding from wherever the light is now. */
  aim(el: HTMLElement | null) {
    this.sizes.disconnect();
    if (this.card.current) this.sizes.observe(this.card.current);
    this.el = el;
    // the element and everything it sits in: a live figure above it that grows moves it without resizing it, but it
    // resizes its container
    for (let n = el; n && n !== document.body; n = n.parentElement) this.sizes.observe(n);
    this.radius = el ? Math.min(32, Math.max(10, (parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) + PAD)) : 12;
    this.from = this.cur;
    this.start = performance.now();
    this.schedule();
  }

  schedule = () => {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  stop() {
    cancelAnimationFrame(this.raf);
    this.sizes.disconnect();
  }

  private target(): Frame | null {
    const root = this.root.current;
    const card = this.card.current;
    if (!root || !card) return null;
    const view = { width: root.clientWidth, height: root.clientHeight };
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const box = this.el?.isConnected ? this.el.getBoundingClientRect() : null;
    const light = box ? lightAround({ x: box.x, y: box.y, width: box.width, height: box.height }, view) : null;
    // the root's bottom padding is the safe area (a phone's home indicator)
    const place = this.compact ? dockCard(light, size, view, parseFloat(getComputedStyle(root).paddingBottom) || 0) : placeCard(light, size, view);
    // nothing lit: the light waits behind the card, and opens out of it at the next stop
    return {
      light: light ?? { x: place.x + 8, y: place.y + 8, width: Math.max(0, size.width - 16), height: Math.max(0, size.height - 16) },
      radius: this.radius,
      card: { x: place.x, y: place.y },
    };
  }

  private frame = (now: number) => {
    this.raf = 0;
    const to = this.target();
    if (!to) return;
    const f = this.from;
    const t = this.reduce || !f ? 1 : Math.min(1, (now - this.start) / GLIDE_MS);
    const e = ease(t);
    const cur: Frame =
      !f || t >= 1
        ? to
        : {
            light: {
              x: mix(f.light.x, to.light.x, e),
              y: mix(f.light.y, to.light.y, e),
              width: mix(f.light.width, to.light.width, e),
              height: mix(f.light.height, to.light.height, e),
            },
            radius: mix(f.radius, to.radius, e),
            card: { x: mix(f.card.x, to.card.x, e), y: mix(f.card.y, to.card.y, e) },
          };
    if (t >= 1) this.from = null;
    this.cur = cur;
    const hole = this.hole.current;
    const card = this.card.current;
    if (hole) {
      hole.style.transform = `translate3d(${cur.light.x}px, ${cur.light.y}px, 0)`;
      hole.style.width = `${cur.light.width}px`;
      hole.style.height = `${cur.light.height}px`;
      hole.style.borderRadius = `${cur.radius}px`;
    }
    if (card) {
      card.style.transform = `translate3d(${Math.round(cur.card.x)}px, ${Math.round(cur.card.y)}px, 0)`;
      card.style.opacity = ""; // placed: shown (hidden only until its first frame, and focusable throughout)
    }
    if (t < 1) this.schedule();
  };
}

/**
 * The guided tour: the terminal dims, one part of it stays lit, and a card beside it says what it is. The light glides
 * from stop to stop. The page underneath is inert while it runs; → and ← step through it, Esc ends it.
 */
export function Tour() {
  const step = useStore(tour, (t) => t.step);
  const compact = !useMedia("(min-width: 64rem)", true);
  const reduce = useMedia("(prefers-reduced-motion: reduce)", false);
  const mac = useSyncExternalStore(noop, () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), () => true);
  const path = usePathname() ?? "";
  const spec = useMemo(() => marketByTicker(decodeURIComponent(path.split("/")[2] ?? "")) ?? marketByTicker("aNVDA")!, [path]);
  const v = useVenue();
  // the market as the terminal shows it: live where the network lists it, otherwise the simulation's
  const market = useMemo(() => (v.mode === "live" && v.net ? (liveMarket(spec, v.net) ?? demoMarket(spec)) : demoMarket(spec)), [spec, v.mode, v.net]);
  const live = v.mode === "live" && market !== demoMarket(spec);
  const regime = useStore(market.store, (s) => s.regime.name);
  const causal = useStore(market.store, (s) => !!s.causal);
  const signedIn = !!useStore(identity, (x) => x);
  const plan = useMemo(() => stepsFor(compact), [compact]);
  const index = Math.min(step, plan.length - 1);
  const { step: s, anchor } = plan[index]!;
  const last = index === plan.length - 1;
  const stock = spec.kind === "equity" || spec.kind === "etf" || spec.kind === "gold";
  const ctx: TourContext = {
    ticker: spec.ticker,
    live,
    network: v.net ? networkName(v.net.network) : null,
    mainnet: v.mode === "live" && v.net?.network === "mainnet",
    faucet: !!v.net?.faucet,
    signedIn,
    regime,
    causal,
    wait: causal ? (causalWait(spec.symbol)?.p50 ?? null) : null,
    closedWho: stock ? "Wall Street" : spec.kind === "fx" ? "The currency market" : "Its reference market",
    discCadence: spec.regime.discCadence,
    discSeconds: (spec.regime.discCadence * BEAT_MS) / 1000,
    feeBps: spec.feeBps,
    paperQuote: PAPER_QUOTE,
    compact,
    shortcut: mac ? "⌘K" : "Ctrl K",
    stops: plan.length - 1,
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const holeRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const spot = useRef<Spotlight | null>(null);
  // which way the reader is going, so a stop with nothing to light is passed in that direction
  const dir = useRef(1);
  const [leaving, setLeaving] = useState(false);
  const ids = { title: useId(), body: useId() };

  // the page goes inert behind the tour; focus comes to the card, and goes back where it was when the tour ends
  useEffect(() => {
    const sp = (spot.current = new Spotlight(rootRef, holeRef, cardRef));
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const quiet: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement) || el === rootRef.current || el.inert) continue;
      el.inert = true;
      quiet.push(el);
    }
    nextRef.current?.focus({ preventScroll: true });
    addEventListener("scroll", sp.schedule, { capture: true, passive: true });
    addEventListener("resize", sp.schedule);
    return () => {
      removeEventListener("scroll", sp.schedule, { capture: true });
      removeEventListener("resize", sp.schedule);
      sp.stop();
      for (const el of quiet) el.inert = false;
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!spot.current) return;
    spot.current.compact = compact;
    spot.current.reduce = reduce;
    spot.current.schedule();
  }, [compact, reduce]);

  // each stop: find what it lights (the terminal may still be arriving), bring it on screen, and glide to it
  useEffect(() => {
    const sp = spot.current;
    if (!sp) return;
    // the first stop has no Back: focus never falls through to the page
    if (!cardRef.current?.contains(document.activeElement)) nextRef.current?.focus({ preventScroll: true });
    if (!anchor) {
      sp.aim(null);
      return;
    }
    let timer = 0;
    let tries = 0;
    const find = () => {
      const el = findAnchor(anchor);
      if (el) {
        el.scrollIntoView({ block: compact && s.scroll === "center" ? "start" : s.scroll, inline: "nearest", behavior: reduce ? "auto" : "smooth" });
        sp.aim(el);
        return;
      }
      if (tries === 0) sp.aim(null);
      if (++tries <= 40) {
        timer = window.setTimeout(find, 100);
        return;
      }
      // not on this screen after 4 s: pass it, the way the reader was going
      const n = index + dir.current;
      if (n >= plan.length) endTour("done");
      else goToStep(Math.max(0, n));
    };
    find();
    return () => clearTimeout(timer);
  }, [anchor, index, plan.length, compact, reduce, s.scroll]);

  const finish = (outcome: "done" | "dismissed") => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => endTour(outcome), reduce ? 0 : 200);
  };
  const next = () => {
    dir.current = 1;
    if (last) finish("done");
    else goToStep(index + 1);
  };
  const back = () => {
    dir.current = -1;
    if (index > 0) goToStep(index - 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("dismissed");
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const foot = s.foot?.(ctx);
  return createPortal(
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[90] pb-[env(safe-area-inset-bottom)] transition-opacity duration-200 ease-out motion-safe:animate-[fade-in_240ms_ease-out] ${leaving ? "opacity-0" : ""}`}
    >
      {/* the light: a rounded hole in the dimmed page, edged with a champagne hairline */}
      <div
        ref={holeRef}
        aria-hidden
        data-tour-light
        className="pointer-events-none absolute top-0 left-0"
        style={{ boxShadow: "0 0 0 1px color-mix(in oklch, var(--champagne) 75%, transparent), 0 0 0 200vmax var(--tour-scrim)" }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        aria-describedby={ids.body}
        // which stop is showing, and what it lights: for scripts/flow-tour.mjs
        data-tour-stop={s.id}
        data-tour-anchor={anchor ?? undefined}
        style={{ opacity: 0 }}
        className="absolute top-0 left-0 w-[min(480px,calc(100vw-32px))] rounded-[var(--radius-xl)] bg-raised p-5 text-left shadow-float lg:w-[360px]"
      >
        <div className="flex items-center justify-between gap-4">
          <p className="tnum text-xs text-ink-3">{index === 0 ? "Guided tour" : `Stop ${index} of ${plan.length - 1}`}</p>
          <button type="button" onClick={() => finish("dismissed")} className="press tap -mr-1 rounded-[var(--radius-xs)] px-1 text-xs font-medium text-ink-3 hover-fine:text-ink">
            Skip tour
          </button>
        </div>
        {/* each stop is read out as it arrives; focus stays on Next */}
        <div key={s.id} aria-live="polite" className="motion-safe:animate-[fade-in_220ms_ease-out]">
          <h2 id={ids.title} className="text-display-s mt-2.5 text-ink">
            {s.title(ctx)}
          </h2>
          <p id={ids.body} className="mt-2 text-sm leading-relaxed text-ink-2">
            {s.body(ctx)}
          </p>
          {foot ? <p className="mt-2.5 text-xs leading-relaxed text-ink-3">{foot}</p> : null}
        </div>
        <div className="mt-5 flex items-center justify-between gap-4">
          {/* progress, as a dial's markers: the stop you're on drawn long */}
          <ol className="flex items-center gap-1.5" aria-hidden>
            {plan.slice(1).map((p, i) => (
              <li
                key={p.step.id}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${i + 1 === index ? "w-4 bg-champagne" : i + 1 < index ? "w-1.5 bg-champagne/50" : "w-1.5 bg-line-strong"}`}
              />
            ))}
          </ol>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <button type="button" onClick={back} className="press rounded-[var(--radius-sm)] px-3.5 py-2 text-sm font-medium text-ink-2 hairline hover-fine:text-ink">
                Back
              </button>
            ) : null}
            <button ref={nextRef} type="button" onClick={next} className="press rounded-[var(--radius-sm)] bg-ink px-4 py-2 text-sm font-semibold text-bg">
              {index === 0 ? "Start" : last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
