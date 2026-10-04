"use client";

import { useSyncExternalStore } from "react";
import { marketMoment, type MarketMoment } from "./market.ts";

/** A minute clock shared by every subscriber; null on the server so static HTML never states a stale session. */
let current: MarketMoment | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule() {
  const now = Date.now();
  timer = setTimeout(() => {
    current = marketMoment(new Date());
    listeners.forEach((l) => l());
    schedule();
  }, 60_000 - (now % 60_000) + 50);
}

function subscribe(l: () => void) {
  if (!current) current = marketMoment(new Date());
  listeners.add(l);
  if (!timer) schedule();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function useMarketMoment(): MarketMoment | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
