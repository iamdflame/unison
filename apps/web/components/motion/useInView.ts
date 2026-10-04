"use client";

import { useEffect, useState, type RefObject } from "react";

/** True once the element has been (at least `threshold`) on screen; with `once: false`, tracks visibility. */
export function useInView(ref: RefObject<Element | null>, { threshold = 0.3, once = true } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const v = !!e?.isIntersecting;
        if (v || !once) setInView(v);
        if (v && once) io.disconnect();
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold, once]);
  return inView;
}
