import { describe, expect, it } from "vitest";
import { ctaLabel, heroLine, marketMoment } from "../lib/time/market.ts";

// October 2026 is EDT (UTC−4); late November is EST (UTC−5).
describe("marketMoment", () => {
  it("knows the regular session", () => {
    const m = marketMoment(new Date("2026-10-05T14:00:00Z")); // Mon 10:00 ET
    expect(m.phase).toBe("open");
    expect(m.hoursToOpen).toBe(0);
    expect(m.nextChange.toISOString()).toBe("2026-10-05T20:00:00.000Z"); // 16:00 ET close
    expect(heroLine(m)).toBe("Wall Street is open. So are we.");
    expect(ctaLabel(m)).toBe("Start trading");
  });

  it("counts the weekend down to Monday's open", () => {
    const m = marketMoment(new Date("2026-10-03T16:00:00Z")); // Sat 12:00 ET
    expect(m.phase).toBe("weekend");
    expect(m.nextOpen.toISOString()).toBe("2026-10-05T13:30:00.000Z"); // Mon 09:30 ET
    expect(m.hoursToOpen).toBe(45);
    expect(m.nextChange.toISOString()).toBe("2026-10-05T08:00:00.000Z"); // Mon 04:00 ET pre-market
    expect(heroLine(m)).toBe("Wall Street opens in 45 hours. Unison is open now.");
    expect(ctaLabel(m)).toBe("Trade the weekend");
  });

  it("treats Friday night as the weekend and weeknights as overnight", () => {
    expect(marketMoment(new Date("2026-10-10T01:30:00Z")).phase).toBe("weekend"); // Fri 21:30 ET
    expect(marketMoment(new Date("2026-10-07T02:00:00Z")).phase).toBe("overnight"); // Tue 22:00 ET
    expect(ctaLabel(marketMoment(new Date("2026-10-07T02:00:00Z")))).toBe("Trade tonight");
  });

  it("names extended hours and holidays", () => {
    expect(marketMoment(new Date("2026-10-06T11:00:00Z")).phase).toBe("pre-market"); // 07:00 ET
    expect(marketMoment(new Date("2026-10-06T21:00:00Z")).phase).toBe("after-hours"); // 17:00 ET
    expect(marketMoment(new Date("2026-11-26T17:00:00Z")).phase).toBe("holiday"); // Thanksgiving 12:00 ET
  });
});

describe("regimeNow", async () => {
  const { regimeNow } = await import("../lib/unison/regimeNow.ts");
  const { marketByTicker } = await import("../lib/content/markets.ts");
  it("follows the FX week for the pound and Wall Street for stocks", () => {
    const gbp = marketByTicker("GBPm")!;
    const nvda = marketByTicker("aNVDA")!;
    const tuesdayNight = new Date("2026-10-07T02:00:00Z"); // Tue 22:00 ET: stocks closed, FX open
    expect(regimeNow(gbp, tuesdayNight).name).toBe("LIVE");
    expect(regimeNow(nvda, tuesdayNight).name).toBe("DISCOVERY");
    const saturday = new Date("2026-10-03T16:00:00Z");
    expect(regimeNow(gbp, saturday).name).toBe("DISCOVERY");
    expect(regimeNow(marketByTicker("WMON")!, saturday).name).toBe("LIVE");
  });
  it("widens NVDA's weekend band with the square root of time closed", () => {
    const nvda = marketByTicker("aNVDA")!;
    const fridayNight = regimeNow(nvda, new Date("2026-10-10T01:00:00Z")).bandBps; // Fri 21:00 ET, 1 h closed
    const sunday = regimeNow(nvda, new Date("2026-10-11T16:00:00Z")).bandBps; // Sun noon ET
    expect(fridayNight).toBeLessThan(sunday);
    expect(sunday).toBeLessThanOrEqual(nvda.regime.discCapBps);
  });
});
