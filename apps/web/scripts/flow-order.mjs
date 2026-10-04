/** Flow check: place a buy on the demo terminal and capture the toast, the fill and the activity list. */
import { chromium } from "@playwright/test";

const base = process.env.SHOOT_BASE ?? "http://localhost:3000";
const b = await chromium.launch();
// FLOW_WIDTH=390 runs it on a phone (the captures get a -390 suffix)
const width = Number(process.env.FLOW_WIDTH ?? 1440);
const sfx = width === 1440 ? "" : `-${width}`;
const ctx = await b.newContext({
  viewport: { width, height: width <= 500 ? 844 : 900 },
  deviceScaleFactor: width <= 500 ? 3 : 1,
  colorScheme: "dark",
});
await ctx.addInitScript(() => localStorage.setItem("unison.theme", "dark"));
// the dev server's route badge is not part of the product: keep it out of the captures
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.head.appendChild(style);
  });
});
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto(`${base}/trade/aNVDA?demo=1`, { waitUntil: "networkidle" });
// phones and tablets: the ticket is a sheet, opened from the thumb bar
if (width < 1024) await p.getByRole("button", { name: "Buy", exact: true }).click();
await p.getByRole("button", { name: /^Buy 1 aNVDA at/ }).waitFor();
// a marketable buy: from where the auction would clear now (or the last trade, or the band's centre), a little above
{
  await p.getByRole("button", { name: /^(Cross|Last|Ref|Close) \$/ }).first().waitFor();
  const cross = p.getByRole("button", { name: /^Cross \$/ });
  const last = p.getByRole("button", { name: /^Last \$/ });
  await ((await cross.count()) ? cross : (await last.count()) ? last : p.getByRole("button", { name: /^(Ref|Close) \$/ })).click();
  const limit = p.locator('input[name="limit"]:visible');
  await limit.fill((Number(await limit.inputValue()) + 0.5).toFixed(2));
  await limit.press("Enter");
}
await p.locator('input[name="qty"]:visible').fill("2");
await p.getByRole("button", { name: /^Buy 2 aNVDA at/ }).click();
await p.waitForTimeout(250);
await p.screenshot({ path: `brand/shots/flow-1-placed${sfx}.png` });
await p.waitForTimeout(1500);
await p.screenshot({ path: `brand/shots/flow-2-filled${sfx}.png` });
await p.getByRole("tab", { name: "Fills" }).click();
await p.waitForTimeout(300);
await p.screenshot({ path: `brand/shots/flow-3-fills${sfx}.png` });
await p.getByRole("button", { name: /^Certificate for/ }).first().click();
await p.waitForTimeout(2600);
await p.screenshot({ path: `brand/shots/flow-4-certificate${sfx}.png` });
console.log(JSON.stringify({ errors }, null, 1));
await b.close();
