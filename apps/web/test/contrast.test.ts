import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  differenceCiede2000,
  filterDeficiencyDeuter,
  filterDeficiencyProt,
  filterDeficiencyTrit,
  parse,
  wcagContrast,
  type Color,
} from "culori";

/** Reads the token blocks straight from globals.css, so this test guards what ships (whatever its line endings). */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const day = block(':root,\n[data-theme="day"]');
const night = block('[data-theme="night"] {');
/** Each light with each buy/sell palette: the colorblind palette overrides on top of its light. */
const themes = {
  day,
  night,
  "day, colorblind palette": { ...day, ...block('[data-palette="cvd"] [data-theme="day"] {') },
  "night, colorblind palette": { ...night, ...block('[data-palette="cvd"] [data-theme="night"] {') },
};

const color = (theme: Record<string, string>, name: string, seen: string[] = []): Color => {
  const raw = theme[name];
  if (raw === undefined) throw new Error(`no --${name}`);
  // tokens may name other tokens (--buy: var(--buy-std)); follow them as the browser would
  const ref = raw.match(/^var\(--([\w-]+)\)$/);
  if (ref) {
    if (seen.includes(ref[1]!)) throw new Error(`cycle at --${name}`);
    return color(theme, ref[1]!, [...seen, name]);
  }
  const c = parse(raw);
  if (!c) throw new Error(`unparseable --${name}: ${raw}`);
  return c;
};

/** [foreground, background, minimum ratio]. 4.5 for text, 3 for large text / UI graphics / focus rings. */
const pairs: [string, string, number][] = [
  ["ink", "bg", 4.5],
  ["ink-2", "bg", 4.5],
  ["ink-3", "bg", 4.5],
  ["ink", "bg-raised", 4.5],
  ["ink-2", "bg-raised", 4.5],
  ["ink-3", "bg-raised", 4.5],
  ["ink", "bg-sunken", 4.5],
  ["ink-2", "bg-sunken", 4.5],
  ["ink-3", "bg-sunken", 4.5],
  ["accent", "bg", 4.5],
  ["accent", "bg-raised", 4.5],
  ["accent-ink", "accent", 4.5],
  ["buy", "bg", 4.5],
  ["sell", "bg", 4.5],
  ["buy", "bg-raised", 4.5],
  ["sell", "bg-raised", 4.5],
  // the Buy and Sell buttons: their label is set in the page color on the fill
  ["bg", "buy-fill", 4.5],
  ["bg", "sell-fill", 4.5],
  ["halt", "bg", 4.5],
  ["focus", "bg", 3],
  ["champagne", "bg", 3],
];

describe.each(Object.entries(themes))("%s", (_name, theme) => {
  it.each(pairs)("%s on %s meets %s:1", (fg, bg, min) => {
    expect(wcagContrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(min);
  });

  it("keeps buy and sell clearly apart under every color-vision deficiency", () => {
    const buy = color(theme, "buy");
    const sell = color(theme, "sell");
    const de = differenceCiede2000();
    for (const sim of [filterDeficiencyDeuter(1), filterDeficiencyProt(1), filterDeficiencyTrit(1)]) {
      expect(de(sim(buy), sim(sell))).toBeGreaterThan(18);
    }
  });
});

describe("the colorblind palette", () => {
  it("changes buy and sell in both lights, and the night fills with them", () => {
    expect(color(themes["day, colorblind palette"], "buy")).not.toEqual(color(day, "buy"));
    expect(color(themes["night, colorblind palette"], "buy-fill")).not.toEqual(color(night, "buy-fill"));
    expect(color(themes["night, colorblind palette"], "sell-fill")).not.toEqual(color(night, "sell-fill"));
  });

  it("derives the soft tints from the active colors, so they switch too", () => {
    for (const t of [day, night]) {
      expect(t["buy-soft"]).toMatch(/var\(--buy\)/);
      expect(t["sell-soft"]).toMatch(/var\(--sell\)/);
    }
  });
});
