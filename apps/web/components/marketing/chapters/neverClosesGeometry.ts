import type { MarketSpec } from "@/lib/content/markets";

/** Chapter 3's geometry, shared by the server-drawn dial and band and the two live marks the browser adds. */
export const HALF_HOURS = 336;
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const nyParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function slotKind(slot: number): "regular" | "extended" | "closed" {
  const day = Math.floor(slot / 48);
  const h = (slot % 48) / 2;
  if (day >= 5) return "closed";
  if (h >= 9.5 && h < 16) return "regular";
  if ((h >= 4 && h < 9.5) || (h >= 16 && h < 20)) return "extended";
  return "closed";
}

/** Half-hour slot of the week in New York (Monday 00:00 = 0). */
export function nowSlot(at: Date): number {
  const p = Object.fromEntries(nyParts.formatToParts(at).map((x) => [x.type, x.value]));
  const day = DAYS.indexOf(p.weekday ?? "Mon");
  return day * 48 + Number(p.hour) * 2 + (Number(p.minute) >= 30 ? 1 : 0) + (Number(p.minute) % 30) / 30;
}

export const polar = (r: number, slot: number) => {
  const a = (slot / HALF_HOURS) * Math.PI * 2 - Math.PI / 2;
  // Rounded so server and client render byte-identical attributes.
  return [Math.round((300 + r * Math.cos(a)) * 100) / 100, Math.round((300 + r * Math.sin(a)) * 100) / 100] as const;
};

export const arcPath = (r: number, from: number, to: number) => {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  const large = to - from > HALF_HOURS / 2 ? 1 : 0;
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
};

/** The discovery band's chart: max(floor, cap·√(t/H)), t in hours since the close, from the market's parameters. */
export const CW = 560;
export const CH = 300;
export const T_MAX = 60;
export function bandChart(m: MarketSpec) {
  const H = m.regime.discHorizonSec / 3600;
  const cap = m.regime.discCapBps / 100;
  const floor = m.regime.discFloorBps / 100;
  const band = (t: number) => Math.max(floor, cap * Math.sqrt(Math.min(t, H) / H));
  const cx = (t: number) => 40 + (t / T_MAX) * (CW - 60);
  const cy = (pct: number) => CH - 40 - (pct / cap) * (CH - 70);
  return { cap, floor, band, cx, cy };
}
