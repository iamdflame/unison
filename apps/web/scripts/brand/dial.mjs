/**
 * The app icon: an onyx dial with one centre, the ball (the arbor). A fumé sunray of 200 rays (200 beats make a
 * minute) turns from it as sheen, a snailed sub-dial edged with one champagne hairline makes the stem read as a
 * small-seconds hand at 12, the body is polished rhodium and the ball is lume that glows inside its edge.
 */
import { emblem } from "./emblem.mjs";

export function dialSvg(size, markParams, { maskable = false, colors }) {
  const { parts, box } = emblem(markParams);
  const S = 256;
  const markScale = maskable ? 0.5 : 0.6; // maskable art stays inside the 80% safe circle
  const m = (S * markScale) / 48;
  const ox = S / 2 - 24 * m;
  const oy = S / 2 - 24 * m + (maskable ? 0 : 6);
  const cx = S / 2;
  const cy = oy + box.ball.cy * m;
  const rb = box.ball.r * m;

  const rays = [];
  const N = 200;
  for (let i = 0; i < N; i += 2) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const R = 420;
    rays.push(
      `M${cx},${cy.toFixed(2)}L${(cx + R * Math.cos(a0)).toFixed(2)},${(cy + R * Math.sin(a0)).toFixed(2)}L${(cx + R * Math.cos(a1)).toFixed(2)},${(cy + R * Math.sin(a1)).toFixed(2)}Z`,
    );
  }
  const sub = 58; // snailed sub-dial radius, centred on the arbor
  const snail = [];
  for (let r = 6; r < sub; r += 2.1) snail.push(`<circle cx="${cx}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}"/>`);

  const clip = maskable ? "" : `<clipPath id="sq"><rect width="256" height="256" rx="57"/></clipPath>`;
  const body = parts
    .map((p) =>
      p.role === "ball" || p.role === "jewel"
        ? `<path d="${p.d}" fill="url(#lumeBall)"/>`
        : `<path d="${p.d}" fill="url(#rhodium)"/>`,
    )
    .join("");
  const detailed = size >= 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">
<defs>${clip}
<radialGradient id="base" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy.toFixed(2)}" r="240"><stop offset="0" stop-color="#22262f"/><stop offset="0.45" stop-color="#14161c"/><stop offset="1" stop-color="${colors.onyx}"/></radialGradient>
<linearGradient id="rhodium" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f8fb"/><stop offset="0.55" stop-color="#e3e7ee"/><stop offset="1" stop-color="#c3c9d4"/></linearGradient>
<radialGradient id="lumeBall" cx="0.5" cy="0.62" r="0.62"><stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="#e0f6ff"/><stop offset="0.5" stop-color="#cdeeff"/><stop offset="1" stop-color="#8fd0f6"/></radialGradient>
<radialGradient id="halo" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy.toFixed(2)}" r="${(rb * 1.5).toFixed(2)}"><stop offset="0.55" stop-color="${colors.lume}" stop-opacity="0.26"/><stop offset="1" stop-color="${colors.lume}" stop-opacity="0"/></radialGradient>
</defs>
<g${maskable ? "" : ' clip-path="url(#sq)"'}>
<rect width="256" height="256" fill="url(#base)"/>
${detailed ? `<path d="${rays.join("")}" fill="#ffffff" fill-opacity="0.022"/>` : ""}
${detailed && !maskable ? `<g fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="0.7">${snail.join("")}</g>
<circle cx="${cx}" cy="${cy.toFixed(2)}" r="${sub}" fill="none" stroke="#d9cdb0" stroke-opacity="0.5" stroke-width="0.9"/>` : ""}
<g transform="translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${m.toFixed(4)})">${body}</g>
<circle cx="${cx}" cy="${cy.toFixed(2)}" r="${(rb * 1.5).toFixed(2)}" fill="url(#halo)"/>
</g></svg>`;
}
