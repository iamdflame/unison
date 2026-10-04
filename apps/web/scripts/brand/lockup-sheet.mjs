/** Renders the wordmark and lockups at real sizes on both themes: brand/explore/lockups.png */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { formatHex } from "culori";
import { lockupSvg, wordmarkSvg } from "./wordmark.mjs";
import { MARK, MARK_SMALL } from "./mark.mjs";

const day = { bg: formatHex("oklch(0.985 0.003 250)"), ink: formatHex("oklch(0.19 0.012 262)"), jewel: formatHex("oklch(0.47 0.17 264)") };
const night = { bg: formatHex("oklch(0.135 0.006 265)"), ink: formatHex("oklch(0.95 0.006 250)"), jewel: formatHex("oklch(0.88 0.075 228)") };
const row = (t) => `<div class="pane" style="background:${t.bg};color:${t.ink}">
  ${[[18, MARK_SMALL, "text"], [28, MARK, "mid"], [44, MARK, "mid"], [72, MARK, "display"]].map(([h, m, master]) => `<div style="height:${h}px">${lockupSvg(m, { ink: t.ink, jewel: t.jewel, master })}</div>`).join("")}
  ${[[14, "text"], [22, "text"], [32, "mid"], [64, "display"]].map(([h, master]) => `<div style="height:${h}px">${wordmarkSvg({ ink: t.ink, master })}</div>`).join("")}
</div>`;
const html = `<!doctype html><html><head><style>body{margin:0;width:1400px;font-family:sans-serif}
.pane{padding:36px 48px;display:flex;flex-direction:column;gap:30px}.pane div svg{height:100%;width:auto;display:block}</style></head>
<body>${row(day)}${row(night)}</body></html>`;
writeFileSync(new URL("../../brand/explore/lockups.html", import.meta.url), html);
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(html);
await p.screenshot({ path: new URL("../../brand/explore/lockups.png", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage: true });
await b.close();
console.log("brand/explore/lockups.png");
