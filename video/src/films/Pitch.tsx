import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { MUSIC_DEMO } from "./Demo";
import { Idea } from "../scenes/Idea";
import { Ask } from "../scenes/pitch/Ask";
import { Founder } from "../scenes/pitch/Founder";
import { Market } from "../scenes/pitch/Market";
import { Proof, PROOF_SECONDS } from "../scenes/pitch/Proof";
import { Thirteen } from "../scenes/Thirteen";

/**
 * The pitch (≤ 2:00), in the founder's voice: SCRIPT.md §3. Who, the problem, the idea, the proof, the market, and
 * the ask; the photo opens and closes it.
 */
export const PITCH: Beat[] = [
  { id: "founder", Scene: Founder, seconds: 12, voice: [{ id: "pitch-01", at: 0.6 }] },
  { id: "problem", Scene: Thirteen, seconds: 14, voice: [{ id: "pitch-02", at: 0.4 }] },
  {
    id: "idea",
    Scene: Idea,
    seconds: 12,
    voice: [{ id: "pitch-03", at: 0.3 }],
    sfx: [
      { file: "sfx-seal.mp3", at: 2.4, volume: 0.6 },
      { file: "sfx-chime.mp3", at: 6.6, volume: 0.4 },
    ],
  },
  { id: "proof", Scene: Proof, seconds: PROOF_SECONDS, voice: [{ id: "pitch-04", at: 0.3 }] },
  { id: "market", Scene: Market, seconds: 17, voice: [{ id: "pitch-05", at: 0.3 }] },
  { id: "ask", Scene: Ask, seconds: 20, voice: [{ id: "pitch-06", at: 0.3 }] },
];

// The pitch borrows the demo's score, cut to its own moments, until it has one of its own (SCRIPT.md, music-pitch.mp3):
// the score falls away under "Liquid markets for them aren't.", drops on "Next", and rings its bell on "Unison."
export const planPitch = () =>
  plan(PITCH, {
    file: "music-demo.mp3",
    drop: { track: MUSIC_DEMO.drop, beat: "ask", at: 0 },
    end: { track: MUSIC_DEMO.bell, lead: MUSIC_DEMO.fall, beat: "ask", voice: "pitch-06", line: 5, at: -0.2 },
  });

export const Pitch = (props: PlanProps) => <Film beats={PITCH} plan={props} music />;
