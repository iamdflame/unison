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
/** DSF=2: frames at twice the pixel density, the same 1920 × 1080 page */
const DSF = Number(process.env.DSF ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const PAGES = {
  // the standing challenge: its pots, the house sniper on both rules, and every challenger (Envio)
  challenge: { take: "06-challenge", path: "/challenge?network=mainnet", ready: /Snipe us|pot/i, hold: 3000, dwell: 3200, stops: ["Every challenger"], offset: 150 },
  // the film's own receipt: its three times, then "Check it yourself" (offset: its heading clears the sticky header)
  receipt: { take: "05-receipt", path: "/receipt/mainnet/1/111216533", ready: /Check it yourself/, hold: 3000, dwell: 3200, stops: ["Check it yourself"], offset: 150 },
};

const asked = process.argv.slice(2);
if (!asked.length || asked.some((a) => !(a in PAGES))) throw new Error(`usage: node capture/pages.mjs ${Object.keys(PAGES).join("|")}`);

// headless Chrome draws its screencast at the page's CSS size unless the device scale is forced at launch too
const browser = await chromium.launch({ args: DSF > 1 ? [`--force-device-scale-factor=${DSF}`] : [] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DSF, colorScheme: "dark" });
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
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: DSF > 1 ? 88 : 92, maxWidth: 1920 * DSF, maxHeight: 1080 * DSF, everyNthFrame: 1 });
    log(`recording ${segment}`);
    await sleep(p.hold);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (p.stops) {
      // straight to each named section, a smooth scroll, then a hold the film can cut on
      for (const text of p.stops) {
        await page
          .getByText(text)
          .first()
          .evaluate((el, offset) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" }), p.offset ?? 0);
        await sleep(p.dwell);
      }
    } else {
      for (let i = 1; i <= p.steps && i * p.step < height - 1080 + p.step; i++) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), Math.min(i * p.step, height - 1080));
        await sleep(p.dwell);
      }
    }
    await cdp.send("Page.stopScreencast");
    writeFileSync(join(OUT, segment, "events.json"), "[]\n");
    writeFileSync(join(OUT, segment, "meta.json"), JSON.stringify({ viewport: { width: 1920, height: 1080 }, dsf: DSF }));
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
