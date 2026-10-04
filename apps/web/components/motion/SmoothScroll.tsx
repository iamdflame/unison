"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect } from "react";

/**
 * Lenis smooth scrolling for the marketing pages, driven by GSAP's ticker so ScrollTrigger scenes scrub in step.
 * Off under reduced motion and on coarse pointers, where native momentum scrolling is already right.
 */
export function SmoothScroll() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = matchMedia("(pointer: coarse)").matches;
    if (reduce || coarse) return;
    const lenis = new Lenis({ duration: 1.05, easing: (t) => 1 - Math.pow(1 - t, 3.2), anchors: { offset: -80 } });
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);
  return null;
}
