/**
 * Records read-only tours of www.unisonfi.com's pages for the films: each page opened on mainnet, held, then
 * scrolled down in steps, through Chrome's screencast as capture/live.mjs does. Nothing is signed or sent.
 *
 *   node capture/pages.mjs challenge          (from video/; writes footage/live/<take>/, then node capture/encode.mjs)
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "footage", "live");
const SITE = process.env.SITE ?? "https://www.unisonfi.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const PAGES = {
  // the standing challenge: its pots, the house sniper on both rules, and every challenger (Envio)
  challenge: { take: "06-challenge", path: "/challenge?network=mainnet", ready: /Snipe us|pot/i, hold: 3000, step: 620, dwell: 2600, steps: 6 },
};

const asked = process.argv.slice(2);
if (!asked.length || asked.some((a) => !(a in PAGES))) throw new Error(`usage: node capture/pages.mjs ${Object.keys(PAGES).join("|")}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark" });
await ctx.addInitScript(() => {
  localStorage.setItem("unison.theme", "dark");
  localStorage.setItem("unison.tour.v1", "done");
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
let segment = null;
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  if (segment) writeFileSync(join(OUT, segment, `${metadata.timestamp.toFixed(3)}.jpg`), Buffer.from(data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

try {
  for (const name of asked) {
    const p = PAGES[name];
    await page.goto(`${SITE}${p.path}`, { waitUntil: "domcontentloaded" });
    await page.getByText(p.ready).first().waitFor({ timeout: 45_000 });
    await sleep(2500); // live numbers settle
    segment = p.take;
    rmSync(join(OUT, segment), { recursive: true, force: true });
    mkdirSync(join(OUT, segment), { recursive: true });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    log(`recording ${segment}`);
    await sleep(p.hold);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let i = 1; i <= p.steps && i * p.step < height - 1080 + p.step; i++) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), Math.min(i * p.step, height - 1080));
      await sleep(p.dwell);
    }
    await cdp.send("Page.stopScreencast");
    writeFileSync(join(OUT, segment, "events.json"), "[]\n");
    writeFileSync(join(OUT, segment, "page.txt"), await page.evaluate(() => document.body.innerText));
    log(`stopped ${segment} (page ${height}px)`);
    segment = null;
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
