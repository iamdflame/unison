"use client";

import { lazy, Suspense, type ComponentProps } from "react";

const WatchFace = lazy(() => import("./WatchFace").then((m) => ({ default: m.WatchFace })));

/**
 * The stopped watch, fetched only when it is shown. Next sends the root not-found page along with every route, and
 * any client component named there is fetched with every page; this stand-in is all those pages carry.
 */
export function LazyWatchFace(props: ComponentProps<typeof WatchFace>) {
  return (
    <Suspense fallback={<div className={`aspect-square ${props.className ?? ""}`} />}>
      <WatchFace {...props} />
    </Suspense>
  );
}
