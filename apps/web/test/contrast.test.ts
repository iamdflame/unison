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

/** Reads the token blocks straight from globals.css, so this test guards what ships. */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const themes = {
  day: block(':root,\n[data-theme="day"]'),
  night: block('[data-theme="night"] {'),
};

const color = (theme: Record<string, string>, name: string): Color => {
  const c = parse(theme[name]!);
  if (!c) throw new Error(`unparseable --${name}: ${theme[name]}`);
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
  ["halt", "bg", 4.5],
  ["focus", "bg", 3],
  ["champagne", "bg", 3],
];

describe.each(Object.entries(themes))("%s theme", (_name, theme) => {
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
