"use client";

import { TapeClient } from "@unison/sdk";
import { useEffect, useMemo } from "react";
import { marketByTicker, type MarketSpec } from "../content/markets.ts";
import { account as demoAccount, demoMarket, type AccountState, type MarketState, type MyOrder } from "../demo/engine.ts";
import { createStore, shallowEqual, useStore, type Store } from "../store/createStore.ts";
import { netConfig, type NetConfig } from "./config.ts";
import { restoreIdentity } from "./identity.ts";
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
    await Promise.race([new TapeClient(net.tapeUrl).health(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 2500))]);
    restoreIdentity(net);
    venue.set({ mode: "live", net, ready: true });
    watchAccount(net);
  } catch {
    venue.set({ mode: "demo", net, ready: true });
  }
}

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
