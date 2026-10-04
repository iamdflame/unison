/**
 * Recent prints as one hairline, ending in the ball (the last uniform price). Neutral ink on purpose: direction is
 * stated in words and arrows elsewhere, never by colour alone.
 */
export function Spark({ ticks, className = "h-8 w-28" }: { ticks: readonly number[]; className?: string }) {
  const W = 112;
  const H = 32;
  if (ticks.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden />;
  const pad = 3;
  let min = Infinity;
  let max = -Infinity;
  for (const t of ticks) {
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const span = Math.max(1, max - min);
  const x = (i: number) => pad + (i / (ticks.length - 1)) * (W - 2 * pad - 3);
  const y = (t: number) => pad + (1 - (t - min) / span) * (H - 2 * pad);
  const d = ticks.map((t, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(t).toFixed(1)}`).join("");
  const last = ticks[ticks.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
      <path d={d} fill="none" stroke="var(--ink-2)" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(ticks.length - 1)} cy={y(last)} r="2.6" fill="var(--ball-3)" />
    </svg>
  );
}

/** Every nth tick so a long history becomes ~n points, always keeping the latest. */
export function sample(ticks: readonly number[], n = 72): number[] {
  if (ticks.length <= n) return [...ticks];
  const step = ticks.length / n;
  const out: number[] = [];
  for (let i = 0; i < n - 1; i++) out.push(ticks[Math.floor(i * step)]!);
  out.push(ticks[ticks.length - 1]!);
  return out;
}
