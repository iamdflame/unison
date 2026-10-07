import { interpolate, useCurrentFrame } from "remotion";
import { C, F, s } from "../brand";

export interface Cue {
  /** seconds from the start of the composition */
  from: number;
  to: number;
  text: string;
}

/** Burned-in captions of the narration: most people watch the first seconds with the sound off. */
export const Captions = ({ cues }: { cues: Cue[] }) => {
  const f = useCurrentFrame();
  const t = f / s(1);
  const cue = cues.find((c) => t >= c.from && t < c.to);
  if (!cue) return null;
  const local = f - s(cue.from);
  const length = s(cue.to - cue.from);
  const opacity = interpolate(local, [0, s(0.2), length - s(0.2), length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, display: "flex", justifyContent: "center", opacity }}>
      <div
        style={{
          maxWidth: 1240,
          textAlign: "center",
          fontFamily: F.text,
          fontSize: 32,
          lineHeight: 1.35,
          color: C.ink,
          // a soft plate: legible over the live page as over the film's own black
          background: "oklch(0.09 0.005 265 / 0.62)",
          backdropFilter: "blur(10px)",
          borderRadius: 14,
          padding: "8px 22px 10px",
        }}
      >
        {cue.text}
      </div>
    </div>
  );
};
