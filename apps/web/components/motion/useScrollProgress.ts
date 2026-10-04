"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * How far the page has scrolled through a tall section: 0 when its top meets the top of the viewport, 1 when its
 * bottom meets the bottom (a pinned scene's whole run). Measured at most once a frame, and only while the section
 * is near the viewport, so a scene costs nothing when it is out of sight. Under reduced motion it never reports:
 * the scene should draw its finished state statically.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, onProgress: (p: number) => void) {
  const cb = useRef(onProgress);
  useEffect(() => {
    cb.current = onProgress;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let near = false;
    const measure = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const run = r.height - innerHeight;
      cb.current(run > 0 ? Math.min(1, Math.max(0, -r.top / run)) : r.top <= 0 ? 1 : 0);
    };
    const schedule = () => {
      if (near && !frame) frame = requestAnimationFrame(measure);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        near = !!e?.isIntersecting;
        if (near) schedule();
      },
      { rootMargin: "120px 0px" },
    );
    io.observe(el);
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule, { passive: true });
    return () => {
      io.disconnect();
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}
