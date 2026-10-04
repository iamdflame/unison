import type { Metadata } from "next";
import Link from "next/link";
import { FairnessLiveClient } from "@/components/app/pages";
import { VenueBoot } from "@/components/app/VenueBoot";
import { Benchmark } from "@/components/fairness/Benchmark";

export const metadata: Metadata = {
  title: "Fairness",
  description: "Every Unison batch clears at one price, against a reference published after it closed. The live record, the receipt chain, and the research.",
};

export default function FairnessPage() {
  return (
    <>
      <section className="mx-auto max-w-[1440px] px-5 pt-36 pb-6 sm:px-8 lg:px-12 lg:pt-44">
        <h1 className="text-display-xl max-w-4xl text-ink">Proof, batch by batch.</h1>
        <p className="text-lede mt-7 max-w-2xl text-ink-2">
          Every batch clears at one price, inside a band, against a reference published after the batch closed. This page
          is the record as it happens, and the research behind the rule.
        </p>
      </section>
      <FairnessLiveClient />
      <VenueBoot />
      <Benchmark />
      <section className="mx-auto max-w-[1440px] px-5 pb-28 sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/trade/aNVDA" className="press rounded-full bg-ink px-6 py-3.5 text-[15px] font-semibold text-bg shadow-md">
            Open the terminal
          </Link>
          <Link href="/developers" className="press rounded-full px-6 py-3.5 text-[15px] font-semibold text-ink hairline">
            Verify it yourself
          </Link>
        </div>
      </section>
    </>
  );
}
