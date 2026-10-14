import { useId } from "react";
import { MARK_PARTS } from "./mark";
import { MAT } from "./materials";
import { crack, rng } from "./patterns";

/**
 * A sealing-wax seal, pressed with the fork. It is drawn as a height map (height in the red channel: the puddle sloping
 * to a rolled edge, the rim the stamp pushed up, the pressed face, its bead border and the raised mark) and lit by the
 * set's key light with SVG lighting, so the wax catches light the way wax does. `broken` cracks it in two: the halves
 * part and each casts its own shadow.
 */
const h = (v: number) => `rgb(${Math.round(v * 255)},0,0)`;

function HeightMap({ id, seed }: { id: string; seed: number }) {
  const rand = rng(seed);
  const lobes = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.8;
    const d = 66 + rand() * 16;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 15 + rand() * 13 };
  });
  return (
    <>
      <g filter={`url(#edge-${id})`}>
        {lobes.map((l, i) => (
          <circle key={i} cx={l.x} cy={l.y} r={l.r} fill={h(0.4)} />
        ))}
        <circle r={90} fill={`url(#pud-${id})`} />
      </g>
      {/* the rim the stamp pushed up, the pressed face, and its border of beads */}
      <circle r={68} fill="none" stroke={h(0.84)} strokeWidth={12} />
      <circle r={62} fill={h(0.44)} />
      <circle r={55} fill="none" stroke={h(0.6)} strokeWidth={2.2} />
      {Array.from({ length: 44 }, (_, i) => {
        const a = (i / 44) * Math.PI * 2;
        return <circle key={i} cx={58.6 * Math.cos(a)} cy={58.6 * Math.sin(a)} r={1.45} fill={h(0.62)} />;
      })}
      <g transform="scale(1.42) translate(-24 -24)" fill={h(0.7)}>
        {MARK_PARTS.map((p, i) => (
          <path key={i} d={p.d} />
        ))}
      </g>
    </>
  );
}

function Defs({ id, seed }: { id: string; seed: number }) {
  return (
    <defs>
      <radialGradient id={`pud-${id}`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="104">
        <stop offset="0" stopColor={h(0.6)} />
        <stop offset="0.66" stopColor={h(0.6)} />
        <stop offset="0.86" stopColor={h(0.47)} />
        <stop offset="1" stopColor={h(0.2)} />
      </radialGradient>
      <filter id={`edge-${id}`} x="-30%" y="-30%" width="160%" height="160%">
        <feTurbulence type="fractalNoise" baseFrequency="0.034" numOctaves={2} seed={seed} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={15} xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id={`lit-${id}`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="hm" />
        <feGaussianBlur in="hm" stdDeviation={1.5} result="hb" />
        <feDiffuseLighting in="hb" surfaceScale={11} diffuseConstant={1.1} lightingColor="#ffffff" result="diff">
          <feDistantLight azimuth={225} elevation={44} />
        </feDiffuseLighting>
        <feSpecularLighting in="hb" surfaceScale={11} specularConstant={1.3} specularExponent={24} lightingColor="#fff1ec" result="spec">
          <feDistantLight azimuth={225} elevation={36} />
        </feSpecularLighting>
        <feFlood floodColor={MAT.wax.body} result="col" />
        <feComposite in="col" in2="diff" operator="arithmetic" k1={1.2} k2={0} k3={0} k4={0} result="shaded" />
        <feComposite in="spec" in2="shaded" operator="arithmetic" k1={0} k2={0.75} k3={1} k4={0} result="lit" />
        <feComposite in="lit" in2="SourceAlpha" operator="in" />
      </filter>
    </defs>
  );
}

const SHADOW = "drop-shadow(2px 3px 2px rgba(60,18,10,0.30)) drop-shadow(6px 10px 9px rgba(60,18,10,0.30))";
const LIFTED = "drop-shadow(3px 5px 3px rgba(60,18,10,0.30)) drop-shadow(12px 18px 16px rgba(60,18,10,0.30))";

export function WaxSeal({
  x,
  y,
  size,
  rotate = 0,
  seed = 5,
  broken = false,
  crackAngle = -1.05,
}: {
  /** the seal's centre on the card */
  x: number;
  y: number;
  size: number;
  rotate?: number;
  seed?: number;
  broken?: boolean;
  /** the crack's direction, radians */
  crackAngle?: number;
}) {
  const id = useId().replace(/:/g, "");
  const box = (style: React.CSSProperties, child: React.ReactNode, key: string) => (
    <svg key={key} viewBox="-120 -120 240 240" width={size} height={size} style={{ position: "absolute", left: x - size / 2, top: y - size / 2, overflow: "visible", ...style }}>
      {child}
    </svg>
  );
  if (!broken) {
    return box(
      { transform: `rotate(${rotate}deg)`, filter: SHADOW },
      <>
        <Defs id={id} seed={seed} />
        <g filter={`url(#lit-${id})`}>
          <HeightMap id={id} seed={seed} />
        </g>
      </>,
      "whole",
    );
  }
  // the crack, and the two sides of it as clip polygons
  const pts = crack(104, crackAngle, seed + 3);
  const nx = -Math.sin(crackAngle) * 400, ny = Math.cos(crackAngle) * 400;
  const line = pts.map((p) => p.join(",")).join(" ");
  const sideA = [...pts, [pts[pts.length - 1]![0] + nx, pts[pts.length - 1]![1] + ny], [pts[0]![0] + nx, pts[0]![1] + ny]].map((p) => p.join(",")).join(" ");
  const sideB = [...pts, [pts[pts.length - 1]![0] - nx, pts[pts.length - 1]![1] - ny], [pts[0]![0] - nx, pts[0]![1] - ny]].map((p) => p.join(",")).join(" ");
  const half = (side: string, key: string, style: React.CSSProperties, edge: string) =>
    box(
      style,
      <>
        <Defs id={`${id}${key}`} seed={seed} />
        <clipPath id={`side-${id}${key}`}>
          <polygon points={side} />
        </clipPath>
        <clipPath id={`wax-${id}${key}`}>
          <circle r={84} />
        </clipPath>
        <g clipPath={`url(#side-${id}${key})`}>
          <g filter={`url(#lit-${id}${key})`}>
            <HeightMap id={`${id}${key}`} seed={seed} />
          </g>
          {/* the broken face: matte, catching a thin line of light on one side of the crack and shade on the other */}
          <g clipPath={`url(#wax-${id}${key})`}>
            <polyline points={line} fill="none" stroke={edge} strokeWidth={2.4} strokeLinejoin="round" />
          </g>
        </g>
      </>,
      key,
    );
  // how far the halves part, on the card
  const gap = size * 0.075;
  // chips of wax the break threw off, lying near the crack
  const rand = rng(seed + 11);
  const chips = Array.from({ length: 5 }, (_, i) => {
    const t = 0.15 + rand() * 0.9;
    const along = (t - 0.5) * size * 1.1;
    const off = (rand() - 0.25) * size * 0.32;
    return {
      x: x + Math.cos(crackAngle) * along - Math.sin(crackAngle) * off,
      y: y + Math.sin(crackAngle) * along + Math.cos(crackAngle) * off + size * 0.08,
      s: size * (0.035 + rand() * 0.04) * (i === 0 ? 1.5 : 1),
      r: rand() * 360,
    };
  });
  return (
    <>
      {/* the halves part along the crack's normal: side A (the +normal side) one way, side B the other */}
      {half(sideA, "a", { transform: `translate(${(gap * nx) / 400}px, ${(gap * ny) / 400}px) rotate(${rotate + 5}deg)`, filter: SHADOW }, "rgba(255,200,190,0.8)")}
      {half(sideB, "b", { transform: `translate(${(-gap * 1.3 * nx) / 400}px, ${(-gap * 1.3 * ny) / 400}px) rotate(${rotate - 9}deg)`, filter: LIFTED }, "rgba(36,4,8,0.75)")}
      {chips.map((c, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: c.x - c.s / 2,
            top: c.y - c.s / 2,
            width: c.s,
            height: c.s * 0.78,
            transform: `rotate(${c.r}deg)`,
            clipPath: "polygon(12% 0, 88% 14%, 100% 62%, 64% 100%, 8% 82%, 0 30%)",
            background: `radial-gradient(circle at 32% 28%, ${MAT.wax.lit}, ${MAT.wax.body} 55%, ${MAT.wax.deep})`,
            filter: "drop-shadow(1px 2px 1.5px rgba(60,18,10,0.45))",
          }}
        />
      ))}
    </>
  );
}

/**
 * Silk ribbon, two tails from under a seal with swallowtail ends, catching the light along their length. Drawn before
 * the seal so the wax sits on it.
 */
export function Ribbon({ x, y, length, width = 44, spread = [28, -16], tone = "blued" }: { x: number; y: number; length: number; width?: number; spread?: [number, number]; tone?: "blued" | "garnet" }) {
  const silk =
    tone === "blued"
      ? "linear-gradient(90deg, #0b1638 0%, #1a2f78 18%, #3d62c9 36%, #1d3584 54%, #142a6c 72%, #2e4fae 86%, #0d1a46 100%)"
      : "linear-gradient(90deg, #3c0a10 0%, #6e1620 18%, #a83440 36%, #761a24 54%, #5a121b 72%, #8f2a35 86%, #400b12 100%)";
  return (
    <>
      {spread.map((deg, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: x - width / 2,
            top: y,
            width,
            height: length * (i ? 0.88 : 1),
            transformOrigin: "50% 0",
            transform: `rotate(${deg}deg)`,
            background: silk,
            clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 90%, 0 100%)",
            filter: "drop-shadow(2px 5px 5px rgba(50,30,20,0.35))",
          }}
        >
          {/* the twist of silk along its length */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0.18) 34%, rgba(255,255,255,0.08) 62%, rgba(0,0,0,0.22) 100%)" }} />
        </div>
      ))}
    </>
  );
}
