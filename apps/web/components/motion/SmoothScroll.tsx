"use client";

import { useEffect } from "react";

/**
 * Lenis smooth scrolling for the marketing pages, fetched once the page is interactive: reading the page never
 * waits for it. Off under reduced motion and on coarse pointers, where native momentum scrolling is already right.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(pointer: coarse)").matches) return;
    let lenis: { destroy(): void } | null = null;
    let gone = false;
    void import("lenis").then(({ default: Lenis }) => {
      if (gone) return;
      lenis = new Lenis({ duration: 1.05, easing: (t) => 1 - Math.pow(1 - t, 3.2), anchors: { offset: -80 }, autoRaf: true });
    });
    return () => {
      gone = true;
      lenis?.destroy();
    };
  }, []);
  return null;
}
