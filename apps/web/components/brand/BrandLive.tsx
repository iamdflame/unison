"use client";

import { useEffect, useRef, useState } from "react";
import { Emblem, type EmblemHandle } from "./Emblem";

/** The mark, large, struck on request: the tines flex in antiphase and settle; the ball, the reference, never moves. */
export function StrikeMark() {
  const mark = useRef<EmblemHandle>(null);
  return (
    <div className="flex flex-col items-center">
      <button type="button" onClick={() => mark.current?.strike(1)} className="press rounded-[var(--radius-2xl)] p-6 text-ink outline-offset-8" aria-label="Strike the mark">
        <Emblem ref={mark} size={220} jewel title="The Unison mark" />
      </button>
      <p className="mt-2 text-sm text-ink-3">Tap it. That&apos;s a fill.</p>
    </div>
  );
}

const TOKENS: [string, string][] = [
  ["--bg", "Background"],
  ["--bg-raised", "Raised"],
  ["--ink", "Ink"],
  ["--ink-2", "Ink, secondary"],
  ["--accent", "Accent"],
  ["--champagne", "Champagne"],
  ["--buy", "Buy"],
  ["--sell", "Sell"],
  ["--halt", "Halt"],
];

/** One light's palette, read from the live tokens, so this page can never disagree with the product. */
export function Palette({ theme, name, note }: { theme: "day" | "night"; name: string; note: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Read each token back as the browser paints it, in sRGB hex (the CSS pipeline may hand back lab()).
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const cs = getComputedStyle(el);
    const hex = (color: string) => {
      if (!ctx) return color;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `#${[r, g, b].map((x) => (x ?? 0).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    };
    setValues(Object.fromEntries(TOKENS.map(([t]) => [t, hex(cs.getPropertyValue(t).trim())])));
  }, []);
  return (
    <div ref={ref} data-theme={theme} className="overflow-hidden rounded-[var(--radius-xl)] bg-bg text-ink shadow-md hairline">
      <div className="px-6 pt-6 pb-4">
        <p className="text-display-m">{name}</p>
        <p className="mt-1 text-sm text-ink-2">{note}</p>
      </div>
      <ul className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-1">
        {TOKENS.map(([t, label]) => (
          <li key={t} className="flex items-center gap-4 px-6 py-3">
            <span aria-hidden className="size-9 shrink-0 rounded-full ring-1 ring-line-strong" style={{ background: `var(${t})` }} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block truncate font-mono text-xs text-ink-3">
                {t} {values[t] ? `· ${values[t]}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
