/**
 * Logo exploration round: renders every candidate emblem at real sizes (16 → 160 px) on Porcelain and Nocturne,
 * plus a lockup with the wordmark, into one contact sheet per round (brand/explore/round-N.png).
 *
 *   node scripts/brand/explore.mjs [round]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { formatHex } from "culori";
import { emblemSvg } from "./emblem.mjs";
import { ROUNDS } from "./candidates.mjs";

const round = Number(process.argv[2] ?? 1);
const candidates = ROUNDS[round];
if (!candidates) throw new Error(`no round ${round}`);

const hex = (c) => formatHex(c);
const day = { bg: hex("oklch(0.985 0.003 250)"), ink: hex("oklch(0.19 0.012 262)"), jewel: hex("oklch(0.47 0.17 264)") };
const night = { bg: hex("oklch(0.135 0.006 265)"), ink: hex("oklch(0.95 0.006 250)"), jewel: hex("oklch(0.88 0.075 228)") };
const SIZES = [16, 24, 32, 64, 160];

const cell = (c, t) =>
  `<div class="row" style="background:${t.bg};color:${t.ink}">${SIZES.map(
    (s) => `<div class="sz">${emblemSvg(c.params, { ink: t.ink, jewel: t.jewel, bg: t.bg, size: s })}</div>`,
  ).join("")}
  <div class="lock">${emblemSvg(c.params, { ink: t.ink, jewel: t.jewel, bg: t.bg, size: 56 })}<span>UNISON</span></div></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400..600&family=Mona+Sans:wdth,wght@75..125,400..700&display=block" rel="stylesheet">
<style>
  body{margin:0;font-family:"Mona Sans";background:#888;width:${(SIZES.reduce((a, b) => a + b + 28, 0) + 360) * 2}px}
  .cand{display:grid;grid-template-columns:150px 1fr 1fr;align-items:stretch;border-bottom:1px solid #777}
  .id{background:#fff;padding:10px;font:600 13px/1.3 "Mona Sans"}.id small{display:block;font-weight:400;color:#555;margin-top:4px}
  .row{display:flex;align-items:center;gap:28px;padding:16px 20px}
  .sz{display:grid;place-items:center}.sz svg{display:block}
  .lock{display:flex;align-items:center;gap:14px;margin-left:12px}
  .lock span{font-family:"Bodoni Moda";font-variation-settings:"opsz" 96;font-size:34px;letter-spacing:.22em;font-weight:500}
</style></head><body>
${candidates
  .map(
    (c) => `<div class="cand"><div class="id">${c.id}<small>${c.note}</small></div>${cell(c, day)}${cell(c, night)}</div>`,
  )
  .join("")}
</body></html>`;

const dir = new URL("../../brand/explore/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`round-${round}.html`, dir), html);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const out = new URL(`round-${round}.png`, dir);
await page.screenshot({ path: out.pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage: true });
// A 1:1 crop of the small sizes, so 16/24/32 px legibility is judged at true pixels.
await page.setViewportSize({ width: 900, height: 200 });
await browser.close();
console.log(`round ${round}: ${candidates.length} candidates → brand/explore/round-${round}.png`);
