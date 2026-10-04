import { lazy, type ComponentType } from "react";

/**
 * A component fetched on demand: `preload()` when it is likely wanted (hover, focus, idle time), render it inside
 * <Suspense> once it is. The page's first load never carries it.
 */
export function preloadable<P extends object>(load: () => Promise<ComponentType<P>>) {
  let pending: Promise<ComponentType<P>> | null = null;
  const fetchIt = () =>
    (pending ??= load().catch((e: unknown) => {
      pending = null; // a failed fetch is tried again next time
      throw e;
    }));
  const Component = lazy(async () => ({ default: await fetchIt() }));
  return Object.assign(Component, { preload: () => void fetchIt().catch(() => undefined) });
}

/** Runs `fn` when the main thread is idle (or soon, where idle callbacks don't exist). */
export function whenIdle(fn: () => void, timeout = 4000) {
  if (typeof window === "undefined") return;
  if ("requestIdleCallback" in window) requestIdleCallback(() => fn(), { timeout });
  else setTimeout(fn, 1200);
}
