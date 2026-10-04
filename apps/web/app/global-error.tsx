"use client";

import { useEffect } from "react";
import "./globals.css";

/** The root layout itself failed. No fonts or theme script to lean on: system type, the night palette, a retry. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" data-theme="night">
      <body className="grid min-h-dvh place-items-center bg-bg px-6 text-ink">
        <main className="max-w-md">
          <h1 className="text-display-l">
            Something stopped.
            <br />
            <span className="text-ink-3">Not the market.</span>
          </h1>
          <p className="mt-6 text-ink-2">Your funds and orders live on-chain and aren&apos;t affected. Reload to try again.</p>
          <button type="button" onClick={reset} className="press mt-8 rounded-full bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg">
            Reload
          </button>
          {error.digest ? <p className="mt-8 font-mono text-xs text-ink-3">Reference {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
