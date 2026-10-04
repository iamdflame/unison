"use client";

import Link from "next/link";
import { lazy, Suspense, useEffect, type ComponentType } from "react";

// This boundary is part of every route, so its drawings are fetched only when a page actually fails, and skipped if
// that fetch fails too (it may be the network that broke): the words and the two ways out stand on their own.
const art = () => import("@/components/system/ErrorArt");
const nothing: { default: ComponentType } = { default: () => null };
const Lockup = lazy(() => art().then((m) => ({ default: m.ErrorLockup }), () => nothing));
const Watch = lazy(() => art().then((m) => ({ default: m.ErrorWatch }), () => nothing));

/** A route failed to render. Calm, honest, and two ways out. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="mx-auto flex w-full max-w-[1440px] items-center px-5 py-6 sm:px-8 lg:px-12">
        <Link href="/" aria-label="Unison, home" className="rounded-full py-1.5 text-ink outline-offset-4">
          <Suspense fallback={<span className="block h-5 w-28" />}>
            <Lockup />
          </Suspense>
        </Link>
      </header>
      <main id="main" className="mx-auto grid w-full max-w-[1440px] flex-1 items-center gap-10 px-5 pb-20 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-12">
        <div className="order-2 lg:order-1">
          <h1 className="text-display-xl text-ink">
            Something stopped.
            <br />
            <span className="text-ink-3">Not the market. This page.</span>
          </h1>
          <p className="text-lede mt-7 max-w-md text-ink-2">
            Your funds and orders live on-chain and aren&apos;t affected. Try again, or check the venue&apos;s status.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <button type="button" onClick={reset} className="press rounded-full bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg shadow-md">
              Try again
            </button>
            <Link href="/status" className="press rounded-full px-6 py-3.5 text-[15px] font-semibold text-ink hairline">
              Status
            </Link>
          </div>
          {error.digest ? <p className="mt-8 font-mono text-xs text-ink-3">Reference {error.digest}</p> : null}
        </div>
        <div className="order-1 flex justify-center lg:order-2">
          <Suspense fallback={<div className="aspect-square w-[min(74vw,460px)]" />}>
            <Watch />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
