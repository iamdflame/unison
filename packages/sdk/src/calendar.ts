/**
 * US equity session calendar (America/New_York), used by the reference relay and the UI.
 *   04:00–09:30 pre-market   → EXTENDED
 *   09:30–16:00 regular      → OPEN      (13:00 close on early-close days)
 *   16:00–20:00 post-market  → EXTENDED  (17:00 on early-close days)
 *   otherwise, weekends and NYSE holidays → CLOSED  (Unison runs DISCOVERY call auctions)
 * Holiday tables must be refreshed yearly against nyse.com/markets/hours-calendars.
 */
import { Status, type StatusCode } from "./types.ts";

export const NYSE_HOLIDAYS = new Set([
  // 2025
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19",
  "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
  "2027-09-06", "2027-11-25", "2027-12-24",
]);

export const NYSE_EARLY_CLOSES = new Set(["2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24", "2027-11-26"]);

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

export interface NyTime {
  date: string; // YYYY-MM-DD in New York
  weekday: string; // Mon..Sun
  minutes: number; // minutes since local midnight
}

export function nyTime(at: Date): NyTime {
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday ?? "",
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function usEquitySession(at: Date = new Date()): StatusCode {
  const t = nyTime(at);
  if (t.weekday === "Sat" || t.weekday === "Sun" || NYSE_HOLIDAYS.has(t.date)) return Status.CLOSED;
  const early = NYSE_EARLY_CLOSES.has(t.date);
  const open = 9 * 60 + 30;
  const close = early ? 13 * 60 : 16 * 60;
  const postEnd = early ? 17 * 60 : 20 * 60;
  if (t.minutes >= open && t.minutes < close) return Status.OPEN;
  if ((t.minutes >= 4 * 60 && t.minutes < open) || (t.minutes >= close && t.minutes < postEnd)) return Status.EXTENDED;
  return Status.CLOSED;
}

/** Next instant (searching minute by minute, up to 8 days) at which the session status changes. */
export function nextSessionChange(from: Date = new Date()): { at: Date; status: StatusCode } {
  const start = usEquitySession(from);
  const t = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const s = usEquitySession(t);
    if (s !== start) return { at: new Date(t), status: s };
    t.setTime(t.getTime() + 60_000);
  }
  return { at: t, status: start };
}
