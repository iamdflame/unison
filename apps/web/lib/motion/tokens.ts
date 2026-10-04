/**
 * Motion tokens (mirrors the CSS custom properties in app/globals.css).
 * Rules: UI motion stays under 300 ms; never ease-in; only transform, opacity, filter and clip-path animate;
 * presses answer on pointer-down at scale 0.96; exits are softer than enters; every motion has a static cue.
 */
export const duration = {
  instant: 0.1,
  press: 0.14,
  quick: 0.18,
  base: 0.24,
  slow: 0.4,
  cinematic: 0.9,
} as const;

/** Cubic-bezier control points, usable by Motion (`ease`) and WAAPI (`cubic-bezier(...)`). */
export const ease = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
  standard: [0.2, 0, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const css = (e: readonly [number, number, number, number]) => `cubic-bezier(${e.join(",")})`;

/** Springs (Motion). Bounce stays at 0 for UI; only the gentle spring carries a trace of overshoot. */
export const spring = {
  default: { type: "spring", duration: 0.35, bounce: 0 },
  snappy: { type: "spring", duration: 0.25, bounce: 0 },
  gentle: { type: "spring", duration: 0.5, bounce: 0.1 },
} as const;

/** The venue's heartbeat: one batch per Monad block. */
export const BEAT_MS = 300;

/** Stagger for semantic, infrequent entrances. High-frequency UI is never staggered. */
export const stagger = { tight: 0.03, base: 0.06, loose: 0.08 } as const;

/**
 * Tuning-fork resonance: a damped oscillator. Returns the tine displacement (in emblem units) at time t (s)
 * after a strike. Antiphase: the left tine uses -x, the right +x.
 */
export function resonance(t: number, amplitude = 0.4, frequencyHz = 5, decay = 6): number {
  if (t < 0) return 0;
  return amplitude * Math.exp(-decay * t) * Math.sin(2 * Math.PI * frequencyHz * t);
}
