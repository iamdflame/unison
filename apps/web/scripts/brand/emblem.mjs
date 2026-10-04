/**
 * The Unison mark, v2: a tuning-fork U drawn like a Didone letter and finished like a turned watch part.
 *
 *   tines   two parallel stems (`stroke`), counter `gap`, straight length `tine`, hairline serifs on the tips
 *   bowl    outer edge a true semicircle; inner edge carries Didone stress: full `stroke` at the sides, thinning to
 *           `bowlThin` at ±`bowlThinAt`° from the bottom (where it shows), and thickening again to `bowlCenter`
 *           under the stem so the yoke reads as one casting
 *   stem    width `stemWidth`, bracketed into the bowl with concave fillets (`yokeFillet`), visible length
 *           `stemLength`
 *   ball    the resonator / the single price point: a neck that waists in (`neckWaist`) and flows tangentially into
 *           a sphere of radius `ballRadius`. A separate part, so it can be finished as blued steel or lume.
 *
 * Coordinates live in a 48×48 box with the figure centred vertically on its exact extents.
 */
export const DEFAULTS = {
  stroke: 5.5,
  gap: 12.5,
  tine: 17,
  serif: true,
  serifOverhang: 2.4,
  serifHeight: 1.3,
  bowlThin: 2.2,
  bowlThinAt: 34,
  bowlCenter: 2.2,
  stemWidth: 3.9,
  stemLength: 7,
  yokeFillet: 1.5,
  neck: 2.4,
  neckWaist: 0.8,
  ballRadius: 3.6,
  ballAttach: 40,
  overshoot: 0.35,
  opticalShift: 0,
  ballRole: "ball",
};

const f = (n) => Math.round(n * 1000) / 1000;
const pt = (p) => `${f(p[0])},${f(p[1])}`;
const smooth = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export function emblem(params = {}) {
  const p = { ...DEFAULTS, ...params };
  const cx = 24;
  const R = p.stroke + p.gap / 2; // outer radius of the bowl (tine outer edges are tangent to it)
  const Ro = R + p.overshoot; // optical overshoot of the round bottom
  const rb = p.ballRadius;
  const sw = p.stemWidth;
  const a = (p.ballAttach * Math.PI) / 180;

  // Vertical layout (relative to top = 0), then centred in the 48 box.
  const yc0 = p.tine;
  const yJoin0 = yc0 + Math.sqrt(Ro * Ro - (sw / 2) ** 2);
  const yStemEnd0 = yJoin0 + p.stemLength;
  const by0 = yStemEnd0 + p.neck + rb * Math.cos(a);
  const height = by0 + rb;
  const top = (48 - height) / 2 + p.opticalShift;
  const yc = top + yc0;
  const yJoin = top + yJoin0;
  const yStemEnd = top + yStemEnd0;
  const by = top + by0;
  const x0 = cx - R;
  const x1 = cx + R;

  // Inner bowl: from the right inner side (φ = +90°) round the bottom (φ = 0) to the left (φ = −90°).
  const thick = (phiDeg) => {
    const ab = Math.abs(phiDeg);
    if (ab >= p.bowlThinAt) return p.bowlThin + (p.stroke - p.bowlThin) * smooth((ab - p.bowlThinAt) / (90 - p.bowlThinAt));
    return p.bowlThin + (p.bowlCenter - p.bowlThin) * smooth((p.bowlThinAt - ab) / p.bowlThinAt);
  };
  const inner = [];
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const phi = 90 - (180 * i) / N;
    const r = R - thick(phi);
    const rad = (phi * Math.PI) / 180;
    inner.push([cx + r * Math.sin(rad), yc + r * Math.cos(rad)]);
  }

  // Outer bowl meets the stem through concave yoke fillets.
  const rf = p.yokeFillet;
  const onCircle = (x) => [x, yc + Math.sqrt(Ro * Ro - (x - cx) ** 2)];
  const tangentDown = (q) => {
    // direction of travel along the outer circle from the left side toward the bottom
    const phi = Math.atan2(q[0] - cx, q[1] - yc);
    return [Math.cos(phi), -Math.sin(phi)];
  };
  const P1 = onCircle(cx - sw / 2 - rf);
  const Q1 = [cx - sw / 2, yJoin + rf * 0.9];
  const t1 = tangentDown(P1);
  const k = rf * 0.6;
  const P2 = onCircle(cx + sw / 2 + rf);
  const Q2 = [cx + sw / 2, yJoin + rf * 0.9];
  const t2 = tangentDown(P2);

  // Neck geometry (shared by the body outline and the ball).
  const Bl = [cx - rb * Math.sin(a), by - rb * Math.cos(a)];
  const Br = [cx + rb * Math.sin(a), by - rb * Math.cos(a)];
  const Sl = [cx - sw / 2, yStemEnd];
  const Sr = [cx + sw / 2, yStemEnd];
  const kk = p.neck * 0.62;
  const waist = (1 - p.neckWaist) * sw * 0.5;

  const body = [
    `M${pt([x0, top])}`,
    `L${pt([x0, yc])}`,
    `A${f(Ro)},${f(Ro)} 0 0 0 ${pt(P1)}`,
    `C${pt([P1[0] + t1[0] * k, P1[1] + t1[1] * k])} ${pt([Q1[0], Q1[1] - k])} ${pt(Q1)}`,
    `L${pt(Sl)}`,
    // the turned neck: waists in, then meets the sphere tangentially; the chord is covered by the ball
    `C${pt([Sl[0] + waist, Sl[1] + kk])} ${pt([Bl[0] + kk * Math.cos(a), Bl[1] - kk * Math.sin(a)])} ${pt(Bl)}`,
    `L${pt(Br)}`,
    `C${pt([Br[0] - kk * Math.cos(a), Br[1] - kk * Math.sin(a)])} ${pt([Sr[0] - waist, Sr[1] + kk])} ${pt(Sr)}`,
    `L${pt(Q2)}`,
    `C${pt([Q2[0], Q2[1] - k])} ${pt([P2[0] - t2[0] * k, P2[1] - t2[1] * k])} ${pt(P2)}`,
    `A${f(Ro)},${f(Ro)} 0 0 0 ${pt([x1, yc])}`,
    `L${pt([x1, top])}`,
    `L${pt([x1 - p.stroke, top])}`,
    `L${pt([x1 - p.stroke, yc])}`,
    ...inner.slice(1).map((q) => `L${pt(q)}`),
    `L${pt([x0 + p.stroke, top])}`,
    "Z",
  ].join(" ");

  const parts = [{ d: body, role: "body" }];
  if (p.serif) {
    for (const xl of [x0, x1 - p.stroke]) {
      parts.push({ d: rect(xl - p.serifOverhang, top, p.stroke + 2 * p.serifOverhang, p.serifHeight), role: "body" });
    }
  }

  // The ball alone: the resonator, the single price point. Finished separately (blued steel / lume).
  const ball = circle(cx, by, rb);
  parts.push({ d: ball, role: p.ballRole === "jewel" ? "jewel" : "ball" });

  return {
    parts,
    box: { top, bottom: by + rb, cx, R, yc, ball: { cx, cy: by, r: rb } },
  };
}

const circle = (x, y, r) =>
  `M${f(x - r)},${f(y)} a${f(r)},${f(r)} 0 1 0 ${f(2 * r)},0 a${f(r)},${f(r)} 0 1 0 ${f(-2 * r)},0 Z`;
const rect = (x, y, w, h) => `M${f(x)},${f(y)} h${f(w)} v${f(h)} h${f(-w)} Z`;

/**
 * SVG string. `ink` fills the body; `jewel` fills the ball when its role is "jewel" (otherwise the ball is ink);
 * `ballFill` overrides the ball paint (e.g. a gradient url) whatever its role.
 */
export function emblemSvg(params = {}, { ink = "currentColor", jewel = "currentColor", ballFill, size = 48, title, defs = "", bg } = {}) {
  void bg;
  const { parts } = emblem(params);
  const paths = parts
    .map((part) => {
      const isBall = part.role === "ball" || part.role === "jewel";
      const fill = isBall ? (ballFill ?? (part.role === "jewel" ? jewel : ink)) : ink;
      return `<path d="${part.d}" fill="${fill}"/>`;
    })
    .join("");
  const t = title ? `<title>${title}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" role="img"${title ? ` aria-label="${title}"` : ' aria-hidden="true"'}>${t}${defs ? `<defs>${defs}</defs>` : ""}${paths}</svg>`;
}

/** Blued-steel sheen for the ball by day (heat-blued screw head) and lume by night (glows inside its edge). */
export const BALL_FINISH = {
  steel: (id) =>
    `<radialGradient id="${id}" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="#6f7fe0"/><stop offset="0.38" stop-color="#3442b0"/><stop offset="0.8" stop-color="#24318f"/><stop offset="1" stop-color="#1a2366"/></radialGradient>`,
  lume: (id) =>
    `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f2fbff"/><stop offset="0.55" stop-color="#c8ecff"/><stop offset="0.86" stop-color="#9fd9fb"/><stop offset="1" stop-color="#7cc4ef"/></radialGradient>`,
};
