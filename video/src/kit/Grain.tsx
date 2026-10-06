import { AbsoluteFill, useCurrentFrame } from "remotion";

/** Film grain at 3% and a soft vignette, over everything: it keeps flat colour from looking like a slide. */
export const Grain = ({ opacity = 0.035 }: { opacity?: number }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity, mixBlendMode: "overlay" }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={f % 97} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.42) 100%)" }} />
    </AbsoluteFill>
  );
};
