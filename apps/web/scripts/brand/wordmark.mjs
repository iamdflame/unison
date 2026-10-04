/**
 * The UNISON wordmark: Bodoni Moda (opsz 96, wght 500) capitals outlined with opentype.js, tracked and optically
 * kerned by hand. Also builds the lockups, where the tuning-fork mark behaves like a glyph: tine tops at cap height,
 * the bowl on the baseline, stem and ball descending like a descender.
 */
import { readFileSync } from "node:fs";
import opentypeModule from "opentype.js";
import { emblem } from "./emblem.mjs";

const opentype = opentypeModule.default ?? opentypeModule;
const load = (file) => {
  const buf = readFileSync(new URL(`../../assets/fonts/${file}`, import.meta.url));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

/**
 * Optical masters, like a watch dial's printing: the display cut has Bodoni's full hairline contrast; the smaller
 * cuts (opsz 40 / 24, a touch heavier, a touch looser) keep the N's diagonals alive at nav and favicon sizes.
 * Tracking in em; kerning in font units, tuned by eye at 18, 28, 44 and 120 px.
 */
export const MASTERS = {
  display: { font: load("BodoniModa-96-500.ttf"), tracking: 0.15, kern: { "N-I": -24, "I-S": -18, "S-O": 6, "O-N": -12 } },
  mid: { font: load("BodoniModa-40-550.ttf"), tracking: 0.19, kern: { "N-I": -20, "I-S": -14, "O-N": -10 } },
  text: { font: load("BodoniModa-24-600.ttf"), tracking: 0.22, kern: { "N-I": -16, "I-S": -10, "O-N": -8 } },
};

export const UPM = 2000;
export const CAP = 1500;

const f = (n) => Math.round(n * 100) / 100;

/** Outlined wordmark: path data in font units, cap tops at y = 0, baseline at y = CAP. */
export function wordmark(text = "UNISON", master = "display") {
  const { font, ...spacing } = MASTERS[master];
  let x = 0;
  const glyphs = [];
  const chars = [...text];
  chars.forEach((ch, i) => {
    const g = font.charToGlyph(ch);
    const path = g.getPath(x, CAP, UPM);
    glyphs.push({ ch, d: path.toPathData(2), x });
    const next = chars[i + 1];
    if (next) x += g.advanceWidth + spacing.tracking * UPM + (spacing.kern[`${ch}-${next}`] ?? 0);
    else x += g.advanceWidth;
  });
  // Trim the outer sidebearings so the artwork's box is the ink's box.
  const first = font.charToGlyph(chars[0]);
  const last = font.charToGlyph(chars.at(-1));
  const left = first.leftSideBearing;
  const right = x - (last.advanceWidth - last.getBoundingBox().x2);
  return { glyphs, left, right, width: right - left, top: -20, bottom: CAP + 30 };
}

/** The mark scaled into wordmark units so the tines meet the cap height and the bowl sits on the baseline. */
export function markInWordmarkUnits(params) {
  const { parts, box } = emblem(params);
  const bowlBottom = box.yc + box.R + (params.overshoot ?? 0.35);
  const scale = CAP / (bowlBottom - box.top);
  const width = 2 * box.R * scale;
  return { parts, box, scale, width, descent: (box.bottom - bowlBottom) * scale };
}

export function wordmarkSvg({ ink = "currentColor", title = "Unison", master = "display" } = {}) {
  const w = wordmark("UNISON", master);
  const vb = `${f(w.left)} ${w.top} ${f(w.width)} ${w.bottom - w.top}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${title}"><title>${title}</title><path fill="${ink}" d="${w.glyphs.map((g) => g.d).join(" ")}"/></svg>`;
}

/**
 * Horizontal lockup. The gap between mark and wordmark equals the mark's inner gap scaled up (its own clear space),
 * which keeps the pair reading as one word.
 */
export function lockupSvg(params, { ink = "currentColor", jewel = ink, title = "Unison", gapEm = 0.95, master = "display" } = {}) {
  const w = wordmark("UNISON", master);
  const m = markInWordmarkUnits(params);
  const gap = gapEm * UPM;
  const markX = w.left - gap - m.width;
  const tx = markX - (24 - m.box.R) * m.scale; // emblem grid x of the left tine edge is 24 − R
  const ty = -m.box.top * m.scale;
  const markPaths = m.parts
    .map((p) => `<path fill="${p.role === "jewel" ? jewel : ink}" d="${p.d}"/>`)
    .join("");
  const top = Math.min(w.top, 0);
  const bottom = CAP + m.descent + 10;
  const vb = `${f(markX)} ${top} ${f(w.right - markX)} ${f(bottom - top)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${title}"><title>${title}</title><g transform="translate(${f(tx)} ${f(ty)}) scale(${f(m.scale)})">${markPaths}</g><path fill="${ink}" d="${w.glyphs.map((g) => g.d).join(" ")}"/></svg>`;
}
