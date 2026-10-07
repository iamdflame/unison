/**
 * The film's palette and type: the site's Nocturne theme (apps/web/app/globals.css), champagne on ink, blued steel for
 * the one thing that moves, verdigris and garnet for buy and sell. Every number on screen comes from the chain or the
 * tape; nothing here is invented.
 */
export const C = {
  bg: "oklch(0.135 0.006 265)",
  deep: "oklch(0.09 0.005 265)",
  raised: "oklch(0.18 0.008 265)",
  sunken: "oklch(0.148 0.008 265)",
  ink: "oklch(0.95 0.006 250)",
  ink2: "oklch(0.76 0.01 255)",
  ink3: "oklch(0.64 0.01 255)",
  line: "oklch(0.95 0.006 250 / 0.09)",
  lineStrong: "oklch(0.95 0.006 250 / 0.17)",
  accent: "oklch(0.74 0.085 266)",
  glow: "oklch(0.74 0.085 266 / 0.5)",
  buy: "oklch(0.76 0.085 180)",
  sell: "oklch(0.66 0.115 33)",
  champagne: "oklch(0.82 0.05 85)",
  engrave: "oklch(0.82 0.05 85 / 0.12)",
  jewel: "oklch(0.58 0.14 20)",
  halt: "oklch(0.82 0.12 75)",
} as const;

export const F = {
  /** Bodoni Moda at its 96 pt optical size: titles */
  display: "'Bodoni Display', serif",
  /** Bodoni Moda at 24–40 pt: small display */
  displaySmall: "'Bodoni Small', serif",
  text: "'Mona Sans', sans-serif",
  /** Mona Sans Wide: a word that lands on the beat */
  wide: "'Mona Sans Wide', sans-serif",
  mono: "'Fragment Mono', monospace",
} as const;

export const FPS = 60;
export const W = 1920;
export const H = 1080;

/** Seconds to frames. */
export const s = (sec: number) => Math.round(sec * FPS);

/** The film's one easing for anything that settles: quick out, long gentle landing. */
export const settle = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 4);
