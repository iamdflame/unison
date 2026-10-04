/**
 * Starts fetching a screen's code while the page's own scripts are still evaluating, so the download overlaps
 * hydration instead of waiting for it. Call it at module level in a screen's client wrapper, one module per screen:
 * a module shared by several screens would fetch them all. A failed fetch is tried again on use.
 */
export function early<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  const get = () =>
    (pending ??= load().catch((e: unknown) => {
      pending = null;
      throw e;
    }));
  if (typeof window !== "undefined") get().catch(() => undefined);
  return get;
}
