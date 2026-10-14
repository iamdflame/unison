/**
 * Engine-turned patterns, generated: the house never uses stock imagery. The rosette is the site's WatchFace
 * (apps/web/components/brand/WatchFace.tsx) and the frame is its certificate's (apps/web/components/trade/Certificate.tsx),
 * generalised to any size.
 */

/** Rose-engine rosette: `count` equal circles whose centres walk a circle of their own radius, so every one passes
 *  through the centre. The moiré of a hand-turned dial. */
export function rosette(cx: number, cy: number, r: number, count = 72) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { cx: cx + r * Math.cos(a), cy: cy + r * Math.sin(a), r };
  });
}

/** The certificate's guilloché band: `waves` sine waves interlaced around a rounded rectangle's perimeter. */
export function guillocheFrame(w: number, h: number, inset: number, r: number, periods: number, amp = 6, waves = 4) {
  const perim: [number, number, number, number][] = []; // x, y, nx, ny
  const N = 2400;
  const iw = w - 2 * inset;
  const ih = h - 2 * inset;
  const segs: [number, (t: number) => [number, number, number, number]][] = [
    [iw - 2 * r, (t) => [inset + r + t, inset, 0, -1]],
    [(Math.PI * r) / 2, (t) => { const a = -Math.PI / 2 + t / r; return [inset + iw - r + r * Math.cos(a), inset + r + r * Math.sin(a), Math.cos(a), Math.sin(a)]; }],
    [ih - 2 * r, (t) => [inset + iw, inset + r + t, 1, 0]],
    [(Math.PI * r) / 2, (t) => { const a = t / r; return [inset + iw - r + r * Math.cos(a), inset + ih - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]; }],
    [iw - 2 * r, (t) => [inset + iw - r - t, inset + ih, 0, 1]],
    [(Math.PI * r) / 2, (t) => { const a = Math.PI / 2 + t / r; return [inset + r + r * Math.cos(a), inset + ih - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]; }],
    [ih - 2 * r, (t) => [inset, inset + ih - r - t, -1, 0]],
    [(Math.PI * r) / 2, (t) => { const a = Math.PI + t / r; return [inset + r + r * Math.cos(a), inset + r + r * Math.sin(a), Math.cos(a), Math.sin(a)]; }],
  ];
  const total = segs.reduce((s, [len]) => s + len, 0);
  for (let i = 0; i < N; i++) {
    let s = (i / N) * total;
    for (const [len, at] of segs) {
      if (s <= len) {
        perim.push(at(s));
        break;
      }
      s -= len;
    }
  }
  const paths: string[] = [];
  for (let j = 0; j < waves; j++) {
    const phase = (j / waves) * Math.PI * 2;
    let d = "";
    perim.forEach(([x, y, nx, ny], i) => {
      const off = amp * Math.sin((i / N) * Math.PI * 2 * periods + phase);
      d += `${i ? "L" : "M"}${(x + nx * off).toFixed(2)},${(y + ny * off).toFixed(2)}`;
    });
    paths.push(d + "Z");
  }
  return paths;
}

/** A rosette band for a seal or a dial ring: `petals` lobes of a hypotrochoid between radii r0 and r1. */
export function lobedRing(cx: number, cy: number, r0: number, r1: number, petals: number, phase = 0, steps = 720) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = r0 + (r1 - r0) * (0.5 + 0.5 * Math.cos(petals * a + phase));
    d += `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return d + "Z";
}

/** A deterministic random walk, so a still renders the same every time. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A jagged crack across a disc of radius r centred on 0, from angle `from`, as polyline points. */
export function crack(r: number, from: number, seed: number, steps = 9) {
  const rand = rng(seed);
  const pts: [number, number][] = [];
  const ax = Math.cos(from), ay = Math.sin(from);
  const nx = -ay, ny = ax;
  for (let i = 0; i <= steps; i++) {
    const t = -1.3 + (2.6 * i) / steps; // run past the edge on both sides
    const jag = i === 0 || i === steps ? 0 : (rand() - 0.5) * r * 0.22;
    pts.push([ax * t * r + nx * jag, ay * t * r + ny * jag]);
  }
  return pts;
}
