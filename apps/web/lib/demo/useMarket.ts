"use client";

import { useEffect, useMemo } from "react";
import { marketByTicker, type MarketSpec } from "../content/markets.ts";
import { shallowEqual, useStore } from "../store/createStore.ts";
import { account, demoMarket, type AccountState, type DemoMarket, type MarketState } from "./engine.ts";

/** Subscribes to a demo market (it only beats while watched) and selects a slice of its state. */
export function useDemoMarket<S>(ticker: string, select: (m: MarketState) => S, equal?: (a: S, b: S) => boolean): { market: DemoMarket; value: S; spec: MarketSpec } {
  const spec = useMemo(() => marketByTicker(ticker) ?? marketByTicker("aNVDA")!, [ticker]);
  const market = useMemo(() => demoMarket(spec), [spec]);
  useEffect(() => market.retain(), [market]);
  const value = useStore(market.store, select, equal ?? shallowEqual);
  return { market, value, spec };
}

export function useAccount<S>(select: (a: AccountState) => S, equal?: (a: S, b: S) => boolean): S {
  return useStore(account, select, equal ?? shallowEqual);
}
