import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { themeBootScript } from "../lib/theme/script.ts";
import { resolveTheme, THEME_KEY, type ThemeMode } from "../lib/theme/theme.ts";

/** Executes the exact pre-paint script against a fake DOM at a given instant. */
function boot(now: Date, stored: string | null, dark = false) {
  vi.setSystemTime(now);
  const attrs: Record<string, string> = {};
  const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) }, querySelector: () => null };
  const localStorage = { getItem: (k: string) => (k === THEME_KEY ? stored : null) };
  const matchMedia = () => ({ matches: dark });
  new Function("document", "localStorage", "matchMedia", themeBootScript())(document, localStorage, matchMedia);
  return attrs;
}

describe("pre-paint theme script", () => {
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  it("agrees with resolveTheme for every half hour (and a minute after) of 2026", () => {
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2027, 0, 1);
    let checked = 0;
    for (let t = start; t < end; t += 30 * 60_000) {
      for (const at of [t, t + 60_000]) {
        const now = new Date(at);
        expect(boot(now, null)["data-theme"], now.toISOString()).toBe(resolveTheme("market", now, false));
        checked++;
      }
    }
    expect(checked).toBe(35_040);
  });

  it.each<[ThemeMode, boolean, string]>([
    ["light", true, "day"],
    ["dark", false, "night"],
    ["system", true, "night"],
    ["system", false, "day"],
  ])("honours mode %s (prefers dark: %s)", (mode, dark, expected) => {
    const attrs = boot(new Date("2026-10-05T14:00:00Z"), mode, dark);
    expect(attrs["data-theme"]).toBe(expected);
    expect(attrs["data-theme-mode"]).toBe(mode);
  });

  it("falls back to market time when storage is unavailable", () => {
    vi.setSystemTime(new Date("2026-10-03T16:00:00Z")); // Saturday
    const attrs: Record<string, string> = {};
    const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) }, querySelector: () => null };
    const localStorage = { getItem: () => { throw new Error("denied"); } };
    new Function("document", "localStorage", "matchMedia", themeBootScript())(document, localStorage, () => ({ matches: false }));
    expect(attrs["data-theme"]).toBe("night");
  });
});
