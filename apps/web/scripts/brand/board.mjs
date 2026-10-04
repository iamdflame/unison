/** Mark v2 review board: every optical master at its sizes, the finishes, the lockups and the app icon. */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { formatHex } from "culori";
import { BALL, emblemSvg } from "./emblem.mjs";
import { MARK, MARK_MID, MARK_SMALL } from "./mark.mjs";
import { lockupSvg } from "./wordmark.mjs";
import { dialSvg } from "./dial.mjs";

const C = {
  porcelain: formatHex("oklch(0.985 0.003 250)"),
  ink: formatHex("oklch(0.19 0.012 262)"),
  onyx: formatHex("oklch(0.135 0.006 265)"),
  pearl: formatHex("oklch(0.95 0.006 250)"),
  lume: formatHex("oklch(0.88 0.075 228)"),
};
const mark = (params, size, t) => emblemSvg(params, { ink: t === "day" ? C.ink : C.pearl, ballFill: t === "day" ? BALL.steel : BALL.lume, size });
const master = (s) => (s <= 20 ? MARK_SMALL : s < 44 ? MARK_MID : MARK);
const ink = (t) => (t === "day" ? C.ink : C.pearl);
const row = (t) => `<div class="pane" style="background:${t === "day" ? C.porcelain : C.onyx};color:${ink(t)}">
  <div class="sizes">${[16, 24, 32, 48, 64, 120, 240].map((s) => `<div>${mark(master(s), s, t)}<small>${s}</small></div>`).join("")}</div>
  <div class="locks">
    <div style="height:20px">${lockupSvg(MARK_MID, { ink: ink(t), master: "text", gapEm: 0.8 })}</div>
    <div style="height:34px">${lockupSvg(MARK_MID, { ink: ink(t), master: "mid", gapEm: 0.72 })}</div>
    <div style="height:84px">${lockupSvg(MARK, { ink: ink(t), master: "display", gapEm: 0.62 })}</div>
  </div>
</div>`;
const icons = `<div class="pane icons" style="background:#3a3d44">${[512, 180, 87, 60, 40]
  .map((s) => `<div>${dialSvg(s, s >= 120 ? MARK : MARK_MID, { colors: C })}</div>`)
  .join("")}<div>${dialSvg(180, MARK, { colors: C, maskable: true })}<small style="color:#ccc">maskable</small></div></div>`;
const html = `<!doctype html><html><head><style>body{margin:0;width:1800px;font:12px sans-serif}
.pane{padding:28px 40px;display:flex;gap:48px;align-items:center}.sizes{display:flex;gap:28px;align-items:end}
.sizes div{display:flex;flex-direction:column;align-items:center;gap:6px}.sizes small{opacity:.5}
.locks{display:flex;flex-direction:column;gap:22px}.locks svg{height:100%;width:auto;display:block}
.icons{gap:28px;align-items:end}.icons div{display:flex;flex-direction:column;align-items:center;gap:6px}</style></head>
<body>${row("day")}${row("night")}${icons}</body></html>`;
writeFileSync(new URL("../../brand/explore/board-v2.html", import.meta.url), html);
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(html);
await p.screenshot({ path: new URL("../../brand/explore/board-v2.png", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage: true });
await b.close();
console.log("brand/explore/board-v2.png");
