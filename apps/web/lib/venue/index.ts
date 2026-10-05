"use client";

import { TapeClient } from "@unison/sdk/tape";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { marketByTicker, type MarketSpec } from "../content/markets.ts";
import { account as demoAccount, demoMarket, type AccountState, type MarketState, type MyOrder } from "../demo/engine.ts";
import { createStore, shallowEqual, useStore, type Store } from "../store/createStore.ts";
import { netConfig, type NetConfig } from "./config.ts";
import { identity, restoreIdentity, warmSigner } from "./identity.ts";
import { liveAccount, liveMarket, watchAccount } from "./live.ts";

/**
 * One venue for the whole app: live (tape + relayer + chain) when they answer, otherwise the in-browser
 * simulation. `?demo=1` forces the simulation. Components use `useMarket` / `useVenueAccount` and never branch.
 */
export type Mode = "demo" | "live";

export interface VenueState {
  mode: Mode;
  net: NetConfig | null;
  ready: boolean;
}

export const venue = createStore<VenueState>({ mode: "demo", net: null, ready: false });

let booted = false;
export async function bootVenue() {
  if (booted) return;
  booted = true;
  const net = netConfig();
  const forceDemo = new URLSearchParams(location.search).has("demo");
  if (!net || forceDemo) {
    venue.set({ mode: "demo", net, ready: true });
    return;
  }
  try {
    // 8 s, not 2.5: a first TLS handshake to the services from far away takes 2-3 s on its own, and a slow first
    // connection is not a dead venue (users outside the US were landing in the simulation)
    await Promise.race([new TapeClient(net.tapeUrl).health(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 8000))]);
    restoreIdentity(net);
    venue.set({ mode: "live", net, ready: true });
    watchAccount(net);
    // a signed-in trader will sign soon: fetch the signer once the page is idle, not with it
    const warm = () => identity.get() && idle(warmSigner);
    warm();
    identity.subscribe(warm);
  } catch {
    venue.set({ mode: "demo", net, ready: true });
  }
}

const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));

export interface VenueMarket {
  store: Store<MarketState>;
  retain: (opts?: { book?: boolean }) => () => void;
  place: (side: "buy" | "sell", tick: number, qty: number, ioc: boolean) => MyOrder | { error: string } | Promise<MyOrder | { error: string }>;
  cancel: (id: number) => void | Promise<void>;
}

export function useVenue(): VenueState {
  return useStore(venue, (v) => v, shallowEqual);
}

/**
 * The market for a ticker in the current venue (live if listed there, otherwise simulated). Lists pass
 * `{ book: false }`: prints and regime without polling depth.
 */
export function useMarket<S>(ticker: string, select: (m: MarketState) => S, equal?: (a: S, b: S) => boolean, opts?: { book?: boolean }) {
  const v = useVenue();
  const spec: MarketSpec = useMemo(() => marketByTicker(ticker) ?? marketByTicker("aNVDA")!, [ticker]);
  const market: VenueMarket = useMemo(
    () => (v.mode === "live" && v.net ? (liveMarket(spec, v.net) ?? demoMarket(spec)) : demoMarket(spec)),
    [v.mode, v.net, spec],
  );
  const book = opts?.book !== false;
  useEffect(() => market.retain({ book }), [market, book]);
  const value = useStore(market.store, select, equal ?? shallowEqual);
  const live = v.mode === "live" && market !== demoMarket(spec);
  return { market, value, spec, live };
}

export function useVenueAccount<S>(select: (a: AccountState) => S, equal?: (a: S, b: S) => boolean): S {
  const v = useVenue();
  return useStore(v.mode === "live" ? liveAccount : demoAccount, select, equal ?? shallowEqual);
}

/** The market behind a spec in the current venue, outside React (cancel buttons, batch actions). */
export function marketFor(spec: MarketSpec): VenueMarket {
  const v = venue.get();
  return v.mode === "live" && v.net ? (liveMarket(spec, v.net) ?? demoMarket(spec)) : demoMarket(spec);
}

export interface MarkNow {
  refTick: number;
  regime: MarketState["regime"]["name"];
  live: boolean;
  /** the last uniform price, if the market has printed: the second mark while it is closed */
  lastTick: number | null;
}

/**
 * Reference ticks and regimes for several markets at once (no order books), for valuing a portfolio. One
 * snapshot object per change, so a component re-renders only when a mark actually moves.
 */
export function useMarks(specs: readonly MarketSpec[]): Record<string, MarkNow> {
  const v = useVenue();
  const markets = useMemo(() => specs.map((s) => (v.mode === "live" && v.net ? (liveMarket(s, v.net) ?? demoMarket(s)) : demoMarket(s))), [v.mode, v.net, specs]);
  useEffect(() => {
    const release = markets.map((m) => m.retain({ book: false }));
    return () => release.forEach((r) => r());
  }, [markets]);
  const cache = useRef<{ key: string; value: Record<string, MarkNow> } | null>(null);
  const subscribe = useCallback(
    (cb: () => void) => {
      const off = markets.map((m) => m.store.subscribe(cb));
      return () => off.forEach((o) => o());
    },
    [markets],
  );
  const snapshot = useCallback(() => {
    const states = markets.map((m) => m.store.get());
    const key = states.map((s) => `${s.refTick}:${s.regime.name}:${s.last?.tick ?? ""}`).join("|") + `|${v.mode}`;
    if (cache.current?.key === key) return cache.current.value;
    const value = Object.fromEntries(
      specs.map((s, i) => [s.ticker, { refTick: states[i]!.refTick, regime: states[i]!.regime.name, live: v.mode === "live" && markets[i] !== demoMarket(s), lastTick: states[i]!.last?.tick ?? null }]),
    );
    cache.current = { key, value };
    return value;
  }, [markets, specs, v.mode]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
