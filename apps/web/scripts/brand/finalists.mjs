/**
 * Finalists board for the judge panel: each finalist in real use (nav lockup, app icon on an onyx guilloché
 * dial, favicon in a browser tab, hero size) in both themes. Writes brand/explore/finalists.png.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { formatHex } from "culori";
import { emblem, emblemSvg } from "./emblem.mjs";

const hex = (c) => formatHex(c);
const C = {
  porcelain: hex("oklch(0.985 0.003 250)"),
  ink: hex("oklch(0.19 0.012 262)"),
  steel: hex("oklch(0.47 0.17 264)"),
  onyx: hex("oklch(0.135 0.006 265)"),
  onyxRaised: hex("oklch(0.18 0.008 265)"),
  pearl: hex("oklch(0.95 0.006 250)"),
  lume: hex("oklch(0.88 0.075 228)"),
  champagne: hex("oklch(0.82 0.05 85)"),
};

export const FINALISTS = [
  {
    id: "F1 · Resonance",
    params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4, stem: 10, stemEnd: "ball", ballRadius: 3.4, bowlHairline: 1.8 },
  },
  {
    id: "F2 · Resonance fine",
    params: { terminal: "serif", stroke: 5.25, gap: 12.75, stemWidth: 3.8, stem: 11, stemEnd: "ball", ballRadius: 3.1, bowlHairline: 1.7 },
  },
  {
    id: "F3 · Jewel",
    jewel: true,
    params: { terminal: "serif", stroke: 5.25, gap: 12.75, stemWidth: 3.8, stem: 11, stemEnd: "ball", ballRadius: 3.1, bowlHairline: 1.7, ballRole: "jewel" },
  },
  {
    id: "F4 · Letter",
    params: { terminal: "serif", stroke: 5.5, gap: 12.5, stemWidth: 4.5, stem: 10, stemEnd: "serif", bowlHairline: 1.6 },
  },
];
export const SMALL = { stroke: 7.5, gap: 10, stemWidth: 6, stem: 6, stemEnd: "ball", ballRadius: 5 };

/** A sunburst guilloché dial (the app icon's ground). Rays radiate from (cx, cy): the mark's ball, the one price. */
export function dial(size, { bg = C.onyx, line = C.champagne, cx = 128, cy = 128 } = {}) {
  const rays = [];
  const n = 180;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r0 = 2;
    const r1 = 260;
    rays.push(
      `<line x1="${cx + r0 * Math.cos(a)}" y1="${cy + r0 * Math.sin(a)}" x2="${cx + r1 * Math.cos(a)}" y2="${cy + r1 * Math.sin(a)}"/>`,
    );
  }
  const rings = [118, 112].map((r) => `<circle cx="128" cy="128" r="${r}" fill="none"/>`).join("");
  const glow = `<circle cx="${cx}" cy="${cy}" r="70" fill="url(#g)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">
    <defs><radialGradient id="v" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#1b1e26"/><stop offset="1" stop-color="${bg}"/></radialGradient>
    <radialGradient id="g"><stop offset="0" stop-color="${C.lume}" stop-opacity=".16"/><stop offset="1" stop-color="${C.lume}" stop-opacity="0"/></radialGradient>
    <clipPath id="sq"><rect width="256" height="256" rx="56"/></clipPath></defs>
    <g clip-path="url(#sq)"><rect width="256" height="256" fill="url(#v)"/>
    <g stroke="${line}" stroke-opacity="0.09" stroke-width="0.6">${rays.join("")}</g>
    <g stroke="${line}" stroke-opacity="0.22" stroke-width="0.8">${rings}</g>${glow}</g></svg>`;
}

function appIcon(f, size) {
  const params = { ...f.params, ballRole: "jewel" };
  const mark = emblemSvg(params, { ink: C.pearl, jewel: C.lume, bg: C.onyx, size: size * 0.62 });
  const { box } = emblem(params);
  const ballY48 = box.ball ? box.ball.cy : box.bottom;
  const cy = 128 + (ballY48 - 24) * (0.62 * 256) / 48;
  return `<div class="icon" style="width:${size}px;height:${size}px">${dial(size, { cy })}<div class="mk">${mark}</div></div>`;
}

const nav = (f, t) => {
  const day = t === "day";
  return `<div class="nav" style="background:${day ? "rgba(255,255,255,.72)" : "rgba(28,30,38,.66)"};color:${day ? C.ink : C.pearl}">
    ${emblemSvg(f.params, { ink: day ? C.ink : C.pearl, jewel: day ? C.steel : C.lume, bg: day ? C.porcelain : C.onyx, size: 30 })}
    <span class="wm">UNISON</span><span class="links">Markets · Fairness · Developers</span><span class="cta" style="background:${day ? C.ink : C.pearl};color:${day ? C.porcelain : C.onyx}">Start trading</span></div>`;
};

const tab = () =>
  `<div class="tab">${emblemSvg(SMALL, { ink: C.ink, jewel: C.steel, size: 16 })}<span>Unison · the market that never closes</span></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400..600&family=Mona+Sans:wdth,wght@75..125,400..700&display=block" rel="stylesheet">
<style>
body{margin:0;font-family:"Mona Sans";background:#8a8d94;width:1600px}
.f{display:grid;grid-template-columns:200px 1fr 1fr;border-bottom:2px solid #6f727a}
.id{background:#fff;padding:14px;font:600 15px "Mona Sans"}
.pane{padding:22px;display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center}
.hero{display:grid;place-items:center;width:240px;height:240px}
.stack{display:flex;flex-direction:column;gap:16px}
.nav{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-radius:999px;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 8px 24px -10px rgba(0,0,0,.25);backdrop-filter:blur(20px);width:520px}
.wm{font-family:"Bodoni Moda";font-variation-settings:"opsz" 96;font-size:19px;letter-spacing:.24em;font-weight:500}
.links{font-size:13px;opacity:.7;margin-left:auto}.cta{font-size:13px;font-weight:600;padding:8px 14px;border-radius:999px}
.icons{display:flex;gap:18px;align-items:end}
.icon{position:relative;border-radius:22%;overflow:hidden;box-shadow:0 10px 30px -10px rgba(0,0,0,.6)}
.icon svg{display:block}.icon .mk{position:absolute;inset:0;display:grid;place-items:center}
.tab{display:flex;align-items:center;gap:8px;background:#dfe3e8;color:#222;font-size:12px;padding:8px 12px;border-radius:8px 8px 0 0;width:260px}
.lock-big{display:flex;align-items:center;gap:20px}.lock-big .wm{font-size:44px}
</style></head><body>
${FINALISTS.map(
  (f) => `<div class="f"><div class="id">${f.id}</div>
  <div class="pane" style="background:${C.porcelain};color:${C.ink}">
    <div class="hero">${emblemSvg(f.params, { ink: C.ink, jewel: C.steel, bg: C.porcelain, size: 220 })}</div>
    <div class="stack">${nav(f, "day")}<div class="lock-big">${emblemSvg(f.params, { ink: C.ink, jewel: C.steel, bg: C.porcelain, size: 72 })}<span class="wm">UNISON</span></div>${tab()}</div>
  </div>
  <div class="pane" style="background:${C.onyx};color:${C.pearl}">
    <div class="hero">${emblemSvg(f.params, { ink: C.pearl, jewel: C.lume, bg: C.onyx, size: 220 })}</div>
    <div class="stack">${nav(f, "night")}<div class="icons">${appIcon(f, 180)}${appIcon(f, 87)}${appIcon(f, 60)}${appIcon(f, 40)}</div></div>
  </div></div>`,
).join("")}
</body></html>`;

const dir = new URL("../../brand/explore/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("finalists.html", dir), html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL("finalists.png", dir).pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage: true });
await browser.close();
console.log("brand/explore/finalists.png");
