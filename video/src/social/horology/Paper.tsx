import { useId, type ReactNode } from "react";
import { MAT } from "./materials";
import { guillocheFrame } from "./patterns";

/**
 * Certificate stock, lying on the set: cotton paper with a fibre tooth, the house's guilloché band engraved in
 * champagne a little inside its edge, and the layered shadow of a sheet a few millimetres off the surface.
 */
export function Paper({
  x,
  y,
  w,
  h,
  rotate = 0,
  ink = "#8a6d3b",
  periods,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number;
  /** the engraving's colour: champagne */
  ink?: string;
  periods?: number;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const frame = guillocheFrame(w, h, 22, 6, periods ?? Math.round((2 * (w + h)) / 46), 5.5, 4);
  const inner = guillocheFrame(w, h, 22, 6, 1, 0, 1)[0];
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        transform: `rotate(${rotate}deg)`,
        background: `linear-gradient(128deg, #fffefa 0%, ${MAT.paper} 42%, ${MAT.paperEdge} 100%)`,
        borderRadius: 3,
        boxShadow:
          "0 1px 1px rgba(70,50,20,0.10), 0 3px 6px rgba(70,50,20,0.07), 0 14px 26px rgba(70,50,20,0.10), 0 34px 60px rgba(70,50,20,0.14), 0 60px 110px rgba(70,50,20,0.10)",
      }}
    >
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <filter id={`fibre-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9 0.35" numOctaves={3} seed={11} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={w} height={h} filter={`url(#fibre-${id})`} opacity={0.05} style={{ mixBlendMode: "multiply" }} />
        <g fill="none" stroke={ink} strokeWidth={0.95} strokeOpacity={0.8}>
          {frame.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        {/* the hairline the band runs along, and a second just inside it */}
        <path d={inner} fill="none" stroke={ink} strokeWidth={0.6} strokeOpacity={0.55} />
        <rect x={40} y={40} width={w - 80} height={h - 80} rx={3} fill="none" stroke={ink} strokeWidth={0.8} strokeOpacity={0.45} />
      </svg>
      {children}
    </div>
  );
}
