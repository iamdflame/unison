import { useId, type ReactNode } from "react";
import { F } from "../../brand";
import { MAT, type Finish } from "./materials";
import { rosette } from "./patterns";

/**
 * A watch, photographed face on under the set's key light (top left). The case is HTML (a polished steel bezel needs
 * a conic gradient: bands of softbox and studio dark), the rest one SVG in dial units: the case is 1000 units across,
 * the dial 800 (radius 400), so every complication is drawn in the same numbers whatever the card's size.
 *
 *   500 ── 470  bezel, polished          450 ── 405  flange (rehaut), printed track
 *   470 ── 450  inner bevel               405 ── 0    dial
 */
export const DIAL = 400;

const STEEL_DAY = "conic-gradient(from 0deg, #d9dde2 0deg, #9aa1aa 18deg, #3d434b 34deg, #2a2f36 42deg, #8c939c 60deg, #eef0f3 92deg, #ffffff 118deg, #f4f6f8 140deg, #b5bbc3 165deg, #565c65 196deg, #2c3138 214deg, #6d747e 236deg, #d0d4d9 270deg, #ffffff 300deg, #fdfdfe 322deg, #c0c5cc 345deg, #d9dde2 360deg)";
const BEVEL_DAY = "conic-gradient(from 0deg, #6d747e 0deg, #2c3138 30deg, #8d949d 70deg, #ffffff 120deg, #c9ced4 150deg, #f7f8fa 200deg, #9aa1aa 240deg, #3a4048 285deg, #262a30 305deg, #7c838c 335deg, #6d747e 360deg)";
const STEEL_NIGHT = "conic-gradient(from 0deg, #4a5462 0deg, #1d222a 18deg, #07090c 38deg, #11151a 60deg, #3f4855 92deg, #8e9aab 118deg, #c9d4e4 132deg, #6b7686 160deg, #161a20 196deg, #050608 214deg, #262c35 240deg, #6f7a89 280deg, #b3c0d2 305deg, #7f8b9c 325deg, #4a5462 360deg)";
const BEVEL_NIGHT = "conic-gradient(from 0deg, #262c35 0deg, #07090c 30deg, #3d4653 70deg, #a6b3c5 120deg, #5c6777 150deg, #8794a6 200deg, #2e3540 240deg, #0b0d11 290deg, #050608 305deg, #2a313b 335deg, #262c35 360deg)";

const ring = (inner: number, outer = 50) =>
  `radial-gradient(circle at 50% 50%, transparent ${inner}%, #000 ${inner + 0.15}%, #000 ${outer - 0.15}%, transparent ${outer}%)`;

export function Watch({
  cx,
  cy,
  size,
  finish,
  dial = finish === "porcelain" ? "enamel" : "night",
  pushers = false,
  track = "seconds",
  children,
}: {
  cx: number;
  cy: number;
  /** the case's diameter on the card, px */
  size: number;
  finish: Finish;
  dial?: "enamel" | "night";
  /** a chronograph's crown and two pushers, at 3 o'clock */
  pushers?: boolean;
  /** what the flange carries: a seconds track in fifths, or nothing */
  track?: "seconds" | "plain";
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const day = finish === "porcelain";
  const face = dial === "enamel" ? MAT.enamel : MAT.nightEnamel;
  const print = dial === "enamel" ? MAT.print : MAT.lume;
  const k = size / 1000;
  const metal = (w: number, h: number, extra: React.CSSProperties) => (
    <div
      style={{
        position: "absolute",
        width: w * k,
        height: h * k,
        borderRadius: 6 * k,
        background: day
          ? "linear-gradient(180deg, #f6f7f9 0%, #a9afb7 30%, #ffffff 48%, #6c737d 72%, #c9cdd3 100%)"
          : "linear-gradient(180deg, #8a95a5 0%, #2a3039 30%, #a6b2c2 48%, #12161b 72%, #4e5866 100%)",
        boxShadow: day ? "0 6px 10px rgba(60,40,20,0.22)" : "0 6px 12px rgba(0,0,0,0.6)",
        ...extra,
      }}
    />
  );
  // a part on the case's edge at a clock angle (0 at twelve), its long side pointing out
  const part = (r: number, theta: number, w: number, h: number) => {
    const t = (theta * Math.PI) / 180;
    const px = size / 2 + r * k * Math.sin(t);
    const py = size / 2 - r * k * Math.cos(t);
    return metal(w, h, { left: px - (w * k) / 2, top: py - (h * k) / 2, transform: `rotate(${theta - 90}deg)` });
  };
  return (
    <div style={{ position: "absolute", left: cx - size / 2, top: cy - size / 2, width: size, height: size }}>
      {pushers ? (
        <>
          {part(516, 90, 84, 118)}
          {part(504, 58, 78, 52)}
          {part(504, 122, 78, 52)}
        </>
      ) : null}
      {/* the case: polished bezel, then the inner bevel, each catching the softbox in bands */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: day ? STEEL_DAY : STEEL_NIGHT,
          boxShadow: day
            ? "0 2px 3px rgba(60,40,20,0.20), 0 18px 30px rgba(60,40,20,0.20), 0 46px 80px rgba(60,40,20,0.22), 0 90px 140px rgba(60,40,20,0.12)"
            : "0 2px 4px rgba(0,0,0,0.6), 0 24px 48px rgba(0,0,0,0.55), 0 70px 120px rgba(0,0,0,0.5)",
        }}
      />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: day ? "inset 0 0 0 1.5px rgba(40,44,52,0.35)" : "inset 0 0 0 1.5px rgba(0,0,0,0.7)" }} />
      <div style={{ position: "absolute", inset: 30 * k, borderRadius: "50%", background: day ? BEVEL_DAY : BEVEL_NIGHT, WebkitMaskImage: ring(44.4), maskImage: ring(44.4) }} />
      <svg viewBox="-500 -500 1000 1000" width={size} height={size} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <radialGradient id={`glaze-${id}`} cx="0.36" cy="0.3" r="0.82">
            <stop offset="0" stopColor={face.glaze} />
            <stop offset="0.55" stopColor={face.face} />
            <stop offset="1" stopColor={face.shade} />
          </radialGradient>
          <linearGradient id={`flange-${id}`} x1="0.15" y1="0.1" x2="0.85" y2="0.9">
            <stop offset="0" stopColor={day ? "#cfc8ba" : "#04070f"} />
            <stop offset="1" stopColor={day ? "#fdfbf7" : "#2b3c70"} />
          </linearGradient>
          <radialGradient id={`glare-${id}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff" stopOpacity={day ? 0.4 : 0.16} />
            <stop offset="0.6" stopColor="#fff" stopOpacity={day ? 0.12 : 0.05} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </radialGradient>
          <filter id={`tooth-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves={2} seed={4} />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <linearGradient id={`wall-${id}`} x1="0.15" y1="0.1" x2="0.75" y2="0.85">
            <stop offset="0" stopColor={day ? "rgba(70,50,20,0.42)" : "rgba(0,0,0,0.75)"} />
            <stop offset="0.55" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
          <filter id={`soft-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={7} />
          </filter>
          <clipPath id={`dial-${id}`}>
            <circle r={DIAL + 5} />
          </clipPath>
          <clipPath id={`crystal-${id}`}>
            <circle r={450} />
          </clipPath>
        </defs>
        {/* the flange, sloping in toward the dial, and its printed track */}
        <circle r={450} fill={`url(#flange-${id})`} />
        <circle r={449} fill="none" stroke={day ? "rgba(40,30,20,0.45)" : "rgba(0,0,0,0.8)"} strokeWidth={2} />
        {track === "seconds"
          ? Array.from({ length: 300 }, (_, i) => {
              const sec = i % 5 === 0;
              const five = i % 25 === 0;
              return (
                <line
                  key={i}
                  x1={0}
                  y1={-(DIAL + 8)}
                  x2={0}
                  y2={-(DIAL + (five ? 36 : sec ? 26 : 16))}
                  stroke={print}
                  strokeWidth={five ? 3.2 : sec ? 2 : 1}
                  strokeOpacity={sec ? 0.95 : 0.6}
                  transform={`rotate(${i * 1.2})`}
                />
              );
            })
          : null}
        {/* the dial: enamel, glazed toward the light, with a shade where it meets the flange */}
        <g clipPath={`url(#dial-${id})`}>
          <circle r={DIAL + 5} fill={`url(#glaze-${id})`} />
          <rect x={-410} y={-410} width={820} height={820} filter={`url(#tooth-${id})`} opacity={day ? 0.035 : 0.06} style={{ mixBlendMode: day ? "multiply" : "screen" }} />
          {/* the flange wall shades the dial on the side away from the light */}
          <circle r={DIAL + 6} fill="none" stroke={`url(#wall-${id})`} strokeWidth={30} filter={`url(#soft-${id})`} />
          {children}
        </g>
        {/* the crystal: the softbox's reflection, and a crescent where the sapphire's edge catches it */}
        <g clipPath={`url(#crystal-${id})`} style={{ mixBlendMode: "screen" }}>
          <ellipse cx={-150} cy={-205} rx={330} ry={200} transform="rotate(-32 -150 -205)" fill={`url(#glare-${id})`} />
          <rect x={-330} y={-330} width={250} height={92} rx={30} transform="rotate(-38 -205 -284)" fill="#fff" opacity={day ? 0.22 : 0.07} filter={`url(#soft-${id})`} />
        </g>
        <path d="M 300 330 A 446 446 0 0 0 420 150" fill="none" stroke="#fff" strokeOpacity={day ? 0.5 : 0.2} strokeWidth={5} strokeLinecap="round" />
        <circle r={451} fill="none" stroke={day ? "rgba(255,255,255,0.65)" : "rgba(160,190,255,0.25)"} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

/** A hand, pointing at `deg` (0 at twelve, clockwise), drawn in its material and casting its shadow away from the key. */
export function Hand({
  deg,
  kind,
  length,
  tail = 0,
  width,
  material,
  shadow = 1,
}: {
  deg: number;
  kind: "lance" | "breguet" | "baton";
  length: number;
  tail?: number;
  width: number;
  material: "blued" | "gold" | "lume" | "steel";
  /** shadow distance, in multiples of the default */
  shadow?: number;
}) {
  const id = useId().replace(/:/g, "");
  const stops = material === "gold" ? MAT.gold : material === "steel" ? MAT.steel.slice(0, 7) : MAT.blued;
  const w = width;
  let d = "";
  let extra: ReactNode = null;
  if (kind === "lance") {
    // a chronograph hand: a long tapering needle, and a counterweight disc on the tail
    d = `M ${-w * 0.55},${tail} L ${-w * 0.42},${-length * 0.9} L 0,${-length} L ${w * 0.42},${-length * 0.9} L ${w * 0.55},${tail} Z`;
    extra = tail ? <circle cy={tail * 0.74} r={w * 1.55} /> : null;
  } else if (kind === "baton") {
    d = `M ${-w / 2},${tail} L ${-w / 2},${-length + w} L 0,${-length} L ${w / 2},${-length + w} L ${w / 2},${tail} Z`;
  } else {
    // Breguet: tapered shaft, the hollow pomme, a fine tip (apps/web/components/brand/WatchFace.tsx)
    const ring = w * 2.6;
    const cyR = -(length - ring * 3);
    const inner = ring * 0.6;
    const shaftTop = cyR + ring - 0.5;
    d = `M${-w},${tail || 16} L${-w * 0.62},${shaftTop} L${w * 0.62},${shaftTop} L${w},${tail || 16} Z M0,${cyR - ring} a${ring},${ring} 0 1,0 0.001,0 Z M0,${cyR - inner} a${inner},${inner} 0 1,0 0.001,0 Z M${-w * 0.7},${cyR - ring + 0.5} L0,${-length} L${w * 0.7},${cyR - ring + 0.5} Z`;
  }
  const fill = material === "lume" ? MAT.lume : `url(#hand-${id})`;
  return (
    <g>
      <defs>
        <linearGradient id={`hand-${id}`} gradientUnits="userSpaceOnUse" x1={-w * 1.2} y1={0} x2={w * 1.2} y2={0}>
          {stops.map((c, i) => (
            <stop key={i} offset={i / (stops.length - 1)} stopColor={c} />
          ))}
        </linearGradient>
        <filter id={`hs-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={5} />
        </filter>
      </defs>
      {/* the shadow falls down and right, away from the key light */}
      <g transform={`translate(${9 * shadow} ${13 * shadow}) rotate(${deg})`} fill="rgba(20,16,10,0.34)" filter={`url(#hs-${id})`} fillRule="evenodd">
        <path d={d} />
        {extra}
      </g>
      <g transform={`rotate(${deg})`} fill={fill} fillRule="evenodd" style={material === "lume" ? { filter: `drop-shadow(0 0 10px ${MAT.lumeGlow})` } : undefined}>
        <path d={d} />
        {extra}
      </g>
    </g>
  );
}

/** The arbor: a polished cap over the hands. */
export function Arbor({ r = 18, finish }: { r?: number; finish: Finish }) {
  const id = useId().replace(/:/g, "");
  return (
    <g>
      <defs>
        <radialGradient id={`cap-${id}`} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={finish === "porcelain" ? "#b9bec6" : "#7d8796"} />
          <stop offset="1" stopColor={finish === "porcelain" ? "#4c525b" : "#14181e"} />
        </radialGradient>
      </defs>
      <circle cx={4} cy={6} r={r} fill="rgba(20,16,10,0.3)" style={{ filter: "blur(3px)" }} />
      <circle r={r} fill={`url(#cap-${id})`} />
      <circle r={r * 0.32} fill={finish === "porcelain" ? "#2a2f38" : "#05070a"} />
    </g>
  );
}

/** The house rosette, engine-turned into the dial's centre. */
export function Rosette({ r, color, opacity = 0.5, count = 72 }: { r: number; color: string; opacity?: number; count?: number }) {
  return (
    <g fill="none" stroke={color} strokeWidth={0.9} strokeOpacity={opacity}>
      {rosette(0, 0, r / 2, count).map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
    </g>
  );
}

/** Text on a dial, set in the house faces at dial units. */
export function DialText({ x, y, size, children, color, face = "display", weight, spacing, anchor = "middle" }: { x: number; y: number; size: number; children: ReactNode; color: string; face?: "display" | "small" | "text" | "wide"; weight?: number; spacing?: string; anchor?: "start" | "middle" | "end" }) {
  const family = face === "display" ? F.display : face === "small" ? F.displaySmall : face === "wide" ? F.wide : F.text;
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" fill={color} style={{ fontFamily: family, fontSize: size, fontWeight: weight, letterSpacing: spacing }}>
      {children}
    </text>
  );
}

/** A recessed subdial: azurage (fine concentric grooves) catching the light, a sunk edge, and whatever it shows. */
export function Subdial({ x, y, r, finish, children }: { x: number; y: number; r: number; finish: Finish; children?: ReactNode }) {
  const id = useId().replace(/:/g, "");
  const day = finish === "porcelain";
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <linearGradient id={`sunk-${id}`} x1="0.2" y1="0.1" x2="0.8" y2="0.9">
          <stop offset="0" stopColor={day ? "#d8d2c5" : "#04081a"} />
          <stop offset="1" stopColor={day ? "#fbfaf6" : "#26386d"} />
        </linearGradient>
      </defs>
      <circle r={r + 4} fill={`url(#sunk-${id})`} />
      <circle r={r} fill={day ? "#f1ede4" : "#101d42"} />
      <g fill="none" stroke={day ? "#9a907c" : "#7f9be0"} strokeOpacity={day ? 0.22 : 0.18} strokeWidth={0.8}>
        {Array.from({ length: Math.floor(r / 3.2) }, (_, i) => (
          <circle key={i} r={r - i * 3.2} />
        ))}
      </g>
      {children}
    </g>
  );
}
