"use client";

import { useRef } from "react";
import { Emblem, type EmblemHandle } from "@/components/brand/Emblem";
import { Wordmark } from "@/components/brand/Wordmark";

export function BrandLab() {
  const big = useRef<EmblemHandle>(null);
  const nav = useRef<EmblemHandle>(null);
  return (
    <section className="mt-16 grid gap-10">
      <div className="flex items-end gap-10">
        <Emblem ref={big} size={220} jewel title="Unison" />
        <div className="flex flex-col gap-6">
          <button
            type="button"
            className="press rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-bg"
            onPointerDown={() => {
              big.current?.strike(1);
              nav.current?.strike(1);
            }}
          >
            Strike the fork
          </button>
          <div className="flex items-center gap-3">
            <Emblem ref={nav} size={30} jewel />
            <Wordmark capHeight={15} />
          </div>
          <div className="flex items-center gap-3">
            <Emblem size={20} />
            <Wordmark capHeight={11} />
          </div>
        </div>
      </div>
      <Wordmark capHeight={72} />
    </section>
  );
}
