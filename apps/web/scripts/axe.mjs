/**
 * Accessibility sweep: axe-core (WCAG 2.2 A/AA rules) on every page, in both lights, after the page settles.
 * Prints violations grouped by rule with the routes and a sample target; exits non-zero if any remain.
 *
 *   node scripts/axe.mjs            (SHOOT_BASE overrides http://localhost:3000)
 */
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const base = process.env.SHOOT_BASE ?? "http://localhost:3000";
const routes = ["/", "/markets?demo=1", "/trade/aNVDA?demo=1", "/portfolio?demo=1", "/vaults?demo=1", "/vaults/aNVDA?demo=1", "/keys?demo=1", "/fairness", "/developers", "/status", "/brand", "/legal/terms", "/legal/risk", "/nope"];
const b = await chromium.launch();
const byRule = new Map();
for (const theme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => localStorage.setItem("unison.theme", t), theme);
  const page = await ctx.newPage();
  for (const r of routes) {
    await page.goto(`${base}${r}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1800);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("nextjs-portal").analyze();
    for (const v of res.violations) {
      const e = byRule.get(v.id) ?? { impact: v.impact, help: v.help, hits: [] };
      for (const n of v.nodes.slice(0, 3)) e.hits.push(`${theme} ${r}: ${n.target.join(" ")}${n.failureSummary ? ` (${n.failureSummary.split("\n").slice(1, 2).join("").trim().slice(0, 120)})` : ""}`);
      byRule.set(v.id, e);
    }
  }
  await ctx.close();
}
await b.close();
if (byRule.size === 0) {
  console.log("axe: no violations");
} else {
  for (const [id, e] of byRule) {
    console.log(`\n[${e.impact}] ${id}: ${e.help} (${e.hits.length})`);
    for (const h of e.hits.slice(0, 8)) console.log(`  - ${h}`);
  }
  process.exitCode = 1;
}
