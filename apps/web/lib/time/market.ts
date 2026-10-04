import { NYSE_HOLIDAYS, Status, usEquitySession, type StatusCode } from "@unison/sdk";

/**
 * Where Wall Street is in its week, and what that means for Unison: the light of the site, the hero's copy,
 * and the countdowns. Session boundaries (04:00, 09:30, 13:00, 16:00, 17:00, 20:00 ET) all fall on half hours,
 * and New York's UTC offset is a whole number of hours, so stepping UTC half-hours finds every change exactly.
 */
export type Phase = "open" | "pre-market" | "after-hours" | "overnight" | "weekend" | "holiday";

export interface MarketMoment {
  status: StatusCode;
  phase: Phase;
  /** Next instant the session status changes. */
  nextChange: Date;
  /** Next regular-session open (09:30 ET on a trading day). */
  nextOpen: Date;
  /** Hours (rounded down) until the next regular open; 0 while open. */
  hoursToOpen: number;
}

const HALF_HOUR = 30 * 60_000;
const nyParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23" });

function nextBoundary(t: number): number {
  return Math.floor(t / HALF_HOUR) * HALF_HOUR + HALF_HOUR;
}

/** First half-hour boundary after `from` where `pred(status)` holds (searches up to 10 days). */
function findNext(from: Date, pred: (s: StatusCode) => boolean): Date {
  let t = nextBoundary(from.getTime());
  for (let i = 0; i < 480; i++, t += HALF_HOUR) {
    if (pred(usEquitySession(new Date(t)))) return new Date(t);
  }
  return new Date(t);
}

function phaseOf(at: Date, status: StatusCode, holidays: ReadonlySet<string>, nyDate: string): Phase {
  if (status === Status.OPEN) return "open";
  const parts = Object.fromEntries(nyParts.formatToParts(at).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  if (status === Status.EXTENDED) return hour < 12 ? "pre-market" : "after-hours";
  if (holidays.has(nyDate)) return "holiday";
  const day = parts.weekday;
  // Friday after 20:00 through Monday 04:00 is the weekend; other closed hours are overnight.
  if (day === "Sat" || day === "Sun" || (day === "Fri" && hour >= 20) || (day === "Mon" && hour < 4)) return "weekend";
  return "overnight";
}

const nyDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

let memo: { minute: number; value: MarketMoment } | null = null;

export function marketMoment(now: Date = new Date(), holidays: ReadonlySet<string> = NYSE_HOLIDAYS): MarketMoment {
  const minute = Math.floor(now.getTime() / 60_000);
  if (memo && memo.minute === minute) return memo.value;
  const status = usEquitySession(now);
  const nextChange = findNext(now, (s) => s !== status);
  const nextOpen = status === Status.OPEN ? now : findNext(now, (s) => s === Status.OPEN);
  const value: MarketMoment = {
    status,
    phase: phaseOf(now, status, holidays, nyDateFmt.format(now)),
    nextChange,
    nextOpen,
    hoursToOpen: status === Status.OPEN ? 0 : Math.max(0, Math.floor((nextOpen.getTime() - now.getTime()) / 3_600_000)),
  };
  memo = { minute, value };
  return value;
}

/** The hero's second line: plain, true, and specific to this moment. */
export function heroLine(m: MarketMoment): string {
  switch (m.phase) {
    case "open":
      return "Wall Street is open. So are we.";
    case "pre-market":
    case "after-hours":
      return "Wall Street is in extended hours. Unison keeps one price for everyone.";
    case "weekend":
      return `Wall Street opens in ${m.hoursToOpen} hours. Unison is open now.`;
    case "holiday":
      return "Wall Street is closed for the holiday. Unison isn't.";
    default:
      return "Wall Street is asleep. Unison isn't.";
  }
}

/** Call-to-action verb for the moment: trade now, tonight, or this weekend. */
export function ctaLabel(m: MarketMoment): string {
  if (m.phase === "weekend") return "Trade the weekend";
  if (m.phase === "overnight" || m.phase === "after-hours" || m.phase === "holiday") return "Trade tonight";
  return "Start trading";
}
