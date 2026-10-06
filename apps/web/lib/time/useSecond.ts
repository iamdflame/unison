"use client";

import { useSyncExternalStore } from "react";

/** A second clock shared by every subscriber (unix ms); null on the server, so static HTML never states an age. */
let current: number | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(l: () => void) {
  if (current === null) current = Date.now();
  listeners.add(l);
  if (!timer) {
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((f) => f());
    }, 1_000);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useSecond(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
