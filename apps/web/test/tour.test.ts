import { describe, expect, it } from "vitest";
import { dockCard, EDGE, GAP, lightAround, PAD, placeCard } from "../components/tour/placement.ts";
import { STEPS, stepsFor, type TourContext } from "../components/tour/steps.ts";
import { rememberTour, TOUR_KEY, tourSeen } from "../lib/ui/tour.ts";

const view = { width: 1440, height: 900 };
const card = { width: 360, height: 220 };

describe("the tour's light", () => {
  it("pads what it lights", () => {
    expect(lightAround({ x: 100, y: 200, width: 300, height: 50 }, view)).toEqual({ x: 100 - PAD, y: 200 - PAD, width: 300 + 2 * PAD, height: 50 + 2 * PAD });
  });
  it("lights only what is on screen of something taller than it", () => {
    const l = lightAround({ x: 1036, y: -120, width: 380, height: 1400 }, view);
    expect(l.y).toBe(4);
    expect(l.y + l.height).toBe(view.height - 4);
    expect(l.x + l.width).toBeLessThanOrEqual(view.width - 4);
  });
});

describe("the tour's card, on wide screens", () => {
  it("sits below what is lit when it fits, aligned with it", () => {
    const p = placeCard({ x: 16, y: 77, width: 1008, height: 190 }, card, view);
    expect(p).toEqual({ x: 16, y: 77 + 190 + GAP, side: "below" });
  });
  it("goes above when there is no room below", () => {
    const light = { x: 1048, y: 560, width: 360, height: 190 };
    const p = placeCard(light, card, view);
    expect(p.side).toBe("above");
    expect(p.y + card.height + GAP).toBe(light.y);
  });
  it("goes beside a part as tall as the window: right if it fits, else left", () => {
    expect(placeCard({ x: 16, y: 72, width: 600, height: 820 }, card, view).side).toBe("right");
    const p = placeCard({ x: 1028, y: 72, width: 396, height: 820 }, card, view);
    expect(p.side).toBe("left");
    expect(p.x + card.width + GAP).toBe(1028);
  });
  it("stays inside the window", () => {
    // lit at the top right corner (the account button): below it, pulled in from the edge
    const p = placeCard({ x: 1240, y: 4, width: 190, height: 52 }, card, view);
    expect(p.side).toBe("below");
    expect(p.x + card.width).toBe(view.width - EDGE);
    // nowhere beside it fits: docked at the bottom
    const all = placeCard({ x: 4, y: 4, width: 1432, height: 892 }, card, view);
    expect(all.side).toBe("dock-bottom");
    expect(all.y + card.height).toBe(view.height - EDGE);
  });
  it("is centred with nothing lit", () => {
    expect(placeCard(null, card, view)).toEqual({ x: (1440 - 360) / 2, y: (900 - 220) / 2, side: "center" });
  });
});

describe("the tour's card, on phones", () => {
  const phone = { width: 390, height: 844 };
  const sheet = { width: 358, height: 260 };
  it("docks at the bottom, clear of the safe area", () => {
    const p = dockCard({ x: 8, y: 64, width: 374, height: 300 }, sheet, phone, 34);
    expect(p.side).toBe("dock-bottom");
    expect(p.y + sheet.height).toBe(844 - EDGE - 34);
  });
  it("docks at the top when what is lit is low on the screen (the Buy and Sell bar)", () => {
    expect(dockCard({ x: 4, y: 710, width: 382, height: 70 }, sheet, phone).side).toBe("dock-top");
  });
});

describe("the tour's stops", () => {
  it("light the ticket and its outcome on wide screens", () => {
    const wide = stepsFor(false).map((s) => s.anchor);
    expect(wide).toEqual([null, "price", "regime", "strip", "chart", "ticket", "outcome", "account", "activity"]);
  });
  it("light the Buy and Sell bar on phones, and skip the outcome, which is inside the closed sheet", () => {
    const compact = stepsFor(true).map((s) => s.anchor);
    expect(compact).toEqual([null, "price", "regime", "strip", "chart", "thumb", "account", "activity"]);
  });
  it("say what is true for every regime, venue and layout", () => {
    // the simulation, the testnet (test money, a faucet) and the mainnet beta (real money, no faucet), on its causal
    // markets (each auction at Chainlink's next observation) and on the old-rule control
    const venues = [
      { live: false, mainnet: false, network: null, faucet: false, causal: false, wait: null },
      { live: true, mainnet: false, network: "Monad testnet", faucet: true, causal: false, wait: null },
      { live: true, mainnet: true, network: "Monad mainnet", faucet: false, causal: true, wait: "34 s" },
      { live: true, mainnet: true, network: "Monad mainnet", faucet: false, causal: false, wait: null },
    ];
    for (const regime of ["LIVE", "EXTENDED", "DISCOVERY", "REOPENING", "HALTED"] as const)
      for (const venue of venues)
        for (const signedIn of [false, true])
          for (const compact of [false, true]) {
            const c: TourContext = { ticker: "aNVDA", ...venue, signedIn, regime, closedWho: "Wall Street", discCadence: 10, discSeconds: 3, feeBps: 3, paperQuote: 25_000, compact, shortcut: "⌘K", stops: compact ? 7 : 8 };
            for (const s of STEPS) {
              const text = `${s.title(c)} ${s.body(c)} ${s.foot?.(c) ?? ""}`;
              expect(text, `${s.id} ${regime}`).not.toMatch(/undefined|NaN|null/);
              if (!venue.live) expect(text, s.id).not.toMatch(/receipt chain|test funds/);
              // real money is never called test money, paper or a simulation
              if (venue.mainnet) expect(text, s.id).not.toMatch(/test (money|funds)|paper|simulat|mock/i);
              // a causal market never promises a per-block auction or a cancel: its orders are sealed until Chainlink prices them
              if (venue.causal) expect(text, `${s.id} ${regime}`).not.toMatch(/every block|0\.3 s|you cancel/);
              if (venue.causal && s.id === "regime" && (regime === "LIVE" || regime === "EXTENDED")) expect(text).toMatch(/Chainlink.*typically 34 s/);
            }
          }
  });
});

describe("remembering the tour", () => {
  it("is unseen until finished or declined, then seen", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(tourSeen(store)).toBe(false);
    rememberTour("dismissed", store);
    expect(m.get(TOUR_KEY)).toBe("dismissed");
    expect(tourSeen(store)).toBe(true);
  });
  it("counts storage that can't be read as seen, and never throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(tourSeen(blocked)).toBe(true);
    expect(tourSeen(undefined)).toBe(true);
    expect(() => rememberTour("done", blocked)).not.toThrow();
  });
});
