import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, F, FPS } from "../brand";

export interface Cue {
  /** seconds from the start of the composition */
  from: number;
  to: number;
  text: string;
  /** each word and when it is said, from the take's own timing (Plan.tsx) */
  words?: { text: string; from: number; to: number }[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Burned-in captions of the narration, a phrase at a time and lit word by word as it is said: most people watch the
 * first seconds with the sound off, and a caption that follows the voice reads as part of the film, not a subtitle.
 * Large, over a soft shade at the foot of the frame rather than a box.
 */
export const Captions = ({ cues }: { cues: Cue[] }) => {
  const t = useCurrentFrame() / FPS;
  const cue = cues.find((c) => t >= c.from && t < c.to);
  if (!cue) return null;
  const enter = clamp01((t - cue.from) / 0.16);
  const leave = clamp01((cue.to - t) / 0.16);
  const shown = Math.min(enter, leave);
  const words = cue.words?.length ? cue.words : cue.text.split(" ").map((w) => ({ text: w, from: cue.from, to: cue.from }));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "linear-gradient(to top, oklch(0.06 0.004 265 / 0.72) 0%, oklch(0.06 0.004 265 / 0.35) 13%, transparent 26%)", opacity: shown }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 58, display: "flex", justifyContent: "center", opacity: shown, transform: `translateY(${(1 - enter) * 14}px)` }}>
        <div
          style={{
            maxWidth: 1560,
            textAlign: "center",
            fontFamily: F.text,
            fontWeight: 600,
            fontSize: 52,
            lineHeight: 1.18,
            letterSpacing: "-0.01em",
            textShadow: "0 2px 20px oklch(0 0 0 / 0.9), 0 0 3px oklch(0 0 0 / 0.9)",
          }}
        >
          {words.map((w, i) => {
            const now = t >= w.from && t < w.to;
            const said = t >= w.from;
            return (
              <span key={`${w.text}-${i}`} style={{ display: "inline-block", whiteSpace: "pre", color: now ? C.champagne : said ? C.ink : "oklch(0.95 0.006 250 / 0.42)", transform: now ? "translateY(-2px)" : undefined }}>
                {w.text}
                {i < words.length - 1 ? " " : ""}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
