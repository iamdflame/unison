import type { Metadata } from "next";
import Link from "next/link";
import { Lockup } from "@/components/brand/Lockup";
import { WatchFace } from "@/components/brand/WatchFace";

export const metadata: Metadata = { title: "Closed", robots: { index: false } };

/** 404. The one thing on Unison that stops is a watch's seconds hand, so the crown is pulled. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="mx-auto flex w-full max-w-[1440px] items-center px-5 py-6 sm:px-8 lg:px-12">
        <Link href="/" aria-label="Unison, home" className="rounded-full py-1.5 text-ink outline-offset-4">
          <Lockup capHeight={13} />
        </Link>
      </header>
      <main id="main" className="mx-auto grid w-full max-w-[1440px] flex-1 items-center gap-10 px-5 pb-20 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-12">
        <div className="order-2 lg:order-1">
          <h1 className="text-display-xl text-ink">
            This page is closed.
            <br />
            <span className="text-ink-3">The market isn&apos;t.</span>
          </h1>
          <p className="text-lede mt-7 max-w-md text-ink-2">
            Every Unison market clears every 300 ms, nights and weekends included. This address just doesn&apos;t lead
            to one.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/trade/aNVDA" className="press rounded-full bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg shadow-md">
              Open the terminal
            </Link>
            <Link href="/" className="press rounded-full px-6 py-3.5 text-[15px] font-semibold text-ink hairline">
              Home
            </Link>
          </div>
        </div>
        <div className="order-1 flex justify-center lg:order-2">
          <WatchFace hacked caption="Hacking seconds" className="w-[min(74vw,460px)]" />
        </div>
      </main>
    </div>
  );
}
