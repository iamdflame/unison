"use client";

import { useRef, useSyncExternalStore } from "react";

/**
 * A tiny external store for state that changes every 300 ms. Components subscribe to a slice through a selector;
 * a render happens only when the selected value changes (by `equal`), so a beat doesn't re-render the whole app.
 */
export interface Store<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === "function" ? (next as (p: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

export function useStore<T, S>(store: Store<T>, select: (s: T) => S, equal: (a: S, b: S) => boolean = Object.is): S {
  const cache = useRef<{ state: T; value: S } | null>(null);
  const getSnapshot = () => {
    const state = store.get();
    if (cache.current && cache.current.state === state) return cache.current.value;
    const value = select(state);
    if (cache.current && equal(cache.current.value, value)) {
      cache.current = { state, value: cache.current.value };
      return cache.current.value;
    }
    cache.current = { state, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
