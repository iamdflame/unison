/** Flow check: place a buy on the demo terminal and capture the toast, the fill and the activity list. */
import { chromium } from "@playwright/test";

const base = process.env.SHOOT_BASE ?? "http://localhost:3000";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await ctx.addInitScript(() => localStorage.setItem("unison.theme", "dark"));
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto(`${base}/trade/aNVDA?demo=1`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /^Buy 1 aNVDA at/ }).waitFor();
// a marketable buy: from where the auction would clear now (or the last trade, or the band's centre), a little above
{
  await p.getByRole("button", { name: /^(Cross|Last|Ref|Close) \$/ }).first().waitFor();
  const cross = p.getByRole("button", { name: /^Cross \$/ });
  const last = p.getByRole("button", { name: /^Last \$/ });
  await ((await cross.count()) ? cross : (await last.count()) ? last : p.getByRole("button", { name: /^(Ref|Close) \$/ })).click();
  const limit = p.locator("#limit");
  await limit.fill((Number(await limit.inputValue()) + 0.5).toFixed(2));
  await limit.press("Enter");
}
await p.locator("#qty").fill("2");
await p.getByRole("button", { name: /^Buy 2 aNVDA at/ }).click();
await p.waitForTimeout(250);
await p.screenshot({ path: "brand/shots/flow-1-placed.png" });
await p.waitForTimeout(1500);
await p.screenshot({ path: "brand/shots/flow-2-filled.png" });
await p.getByRole("tab", { name: "Fills" }).click();
await p.waitForTimeout(300);
await p.screenshot({ path: "brand/shots/flow-3-fills.png" });
await p.getByRole("button", { name: /^Certificate for/ }).first().click();
await p.waitForTimeout(2600);
await p.screenshot({ path: "brand/shots/flow-4-certificate.png" });
console.log(JSON.stringify({ errors }, null, 1));
await b.close();
