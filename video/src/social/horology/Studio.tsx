import type { ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { F } from "../../brand";
import { LIGHT, type Finish } from "./materials";

/**
 * The set: the surface the object rests on, lit by one large softbox from the top left, with its falloff and a
 * fine texture so the ground reads as a material (porcelain stone by day, blued night by night), never as a flat fill.
 */
export function Studio({ finish, children, keyX = 28, keyY = 18 }: { finish: Finish; children?: ReactNode; keyX?: number; keyY?: number }) {
  const L = LIGHT[finish];
  const day = finish === "porcelain";
  return (
    <AbsoluteFill style={{ background: L.ground, overflow: "hidden" }}>
      {/* the softbox: a broad pool of light, then the fall to the edges */}
      <AbsoluteFill
        style={{
          background: day
            ? `radial-gradient(ellipse 75% 90% at ${keyX}% ${keyY}%, rgba(255,253,248,0.85), rgba(255,253,248,0) 62%)`
            : `radial-gradient(ellipse 65% 80% at ${keyX}% ${keyY}%, rgba(120,150,230,0.16), rgba(120,150,230,0) 60%)`,
        }}
      />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse 120% 110% at ${keyX + 12}% ${keyY + 22}%, transparent 48%, ${L.groundEdge} 100%)` }}
      />
      {/* the material: stone mottling and a fine tooth */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: day ? 0.07 : 0.1, mixBlendMode: day ? "multiply" : "screen" }}>
        <filter id={`ground-${finish}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0065" numOctaves={3} seed={7} result="m" />
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={3} result="t" />
          <feBlend in="m" in2="t" mode="multiply" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#ground-${finish})`} />
      </svg>
      {children}
    </AbsoluteFill>
  );
}

/** A soft shadow on the ground, for an object that isn't a DOM box: an ellipse blurred out, offset away from the key. */
export function ContactShadow({ x, y, w, h, opacity = 0.32, blur = 26, color }: { x: number; y: number; w: number; h: number; opacity?: number; blur?: number; color: string }) {
  return <div style={{ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h, borderRadius: "50%", background: color, opacity, filter: `blur(${blur}px)` }} />;
}

/** The lockup, in the light's ink, and the address. Nothing sits under the mark. */
export function Masthead({ finish, url = true }: { finish: Finish; url?: boolean }) {
  const L = LIGHT[finish];
  return (
    <>
      <Img
        src={staticFile(finish === "porcelain" ? "brand/unison-lockup-ink.svg" : "brand/unison-lockup-porcelain.svg")}
        style={{ position: "absolute", left: 72, top: 62, height: 34, opacity: finish === "porcelain" ? 0.92 : 0.95 }}
      />
      {url ? (
        <div style={{ position: "absolute", right: 72, top: 64, fontFamily: F.text, fontSize: 26, letterSpacing: "0.01em", color: L.ink3 }}>unisonfi.com</div>
      ) : null}
    </>
  );
}

/** The one line in Bodoni, and a quiet line under it. Sentence case, no eyebrow. */
export function Headline({ finish, lines, sub, x = 72, y = 132, size = 86, width = 1460, subSize = 32 }: { finish: Finish; lines: string[]; sub?: string; x?: number; y?: number; size?: number; width?: number; subSize?: number }) {
  const L = LIGHT[finish];
  return (
    <div style={{ position: "absolute", left: x, top: y, width }}>
      {lines.map((l) => (
        <div key={l} style={{ fontFamily: F.display, fontSize: size, lineHeight: 1.06, color: L.ink, letterSpacing: "-0.005em", whiteSpace: "nowrap" }}>
          {l}
        </div>
      ))}
      {sub ? <div style={{ fontFamily: F.text, fontSize: subSize, lineHeight: 1.35, color: L.ink2, marginTop: 18, maxWidth: width }}>{sub}</div> : null}
    </div>
  );
}
