import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { Agent } from "../scenes/Agent";
import { Close } from "../scenes/Close";
import { ColdOpen } from "../scenes/ColdOpen";
import { Idea } from "../scenes/Idea";
import { Live, LIVE_CUES, LIVE_SECONDS } from "../scenes/Live";
import { PhotoFinish } from "../scenes/PhotoFinish";
import { SnipeUs } from "../scenes/SnipeUs";
import { Thirteen } from "../scenes/Thirteen";
import { Verify, VERIFY_LINES } from "../scenes/Verify";

/**
 * The demo (≤ 3:00), "The thirteen seconds": SCRIPT.md §2. The voice lines land where the picture earns them:
 * "sealed" as the order's row appears, "There." on the fill, one rimshot per PASS.
 */
export const DEMO: Beat[] = [
  {
    id: "cold-open",
    Scene: ColdOpen,
    seconds: 12,
    // the narration is set in the scene's own type
    captions: false,
    voice: [{ id: "demo-01", at: 0.9 }],
    sfx: [0, 0.3, 0.6, 0.9, 1.2, 1.5].map((at) => ({ file: "sfx-tick.mp3", at, volume: 0.22 })),
  },
  { id: "thirteen", Scene: Thirteen, seconds: 14, voice: [{ id: "demo-02", at: 0.4 }] },
  {
    id: "idea",
    Scene: Idea,
    seconds: 12,
    captions: false,
    voice: [{ id: "demo-03", at: 0.3 }],
    sfx: [
      { file: "sfx-seal.mp3", at: 2.52, volume: 0.55 },
      { file: "sfx-chime.mp3", at: 9.25, volume: 0.38 },
    ],
  },
  {
    id: "live",
    Scene: Live,
    seconds: LIVE_SECONDS,
    fixed: true,
    voice: [
      { id: "demo-04", at: 0.5 },
      // "The order is sealed, right here in this block" as its row appears; the line before it rides the ticket
      { id: "demo-05", line: 1, on: LIVE_CUES.sealed + 0.1 },
      { id: "demo-06", at: LIVE_CUES.drop - 0.1 },
      { id: "demo-07", at: LIVE_CUES.receipt + 0.35 },
    ],
    sfx: [
      { file: "sfx-seal.mp3", at: LIVE_CUES.sealed, volume: 0.5 },
      { file: "sfx-chime.mp3", at: LIVE_CUES.drop, volume: 0.42 },
    ],
  },
  {
    id: "verify",
    Scene: Verify,
    seconds: 12,
    voice: [{ id: "demo-08", at: 0.2 }],
    sfx: VERIFY_LINES.filter((l) => l.kind === "pass").map((l) => ({ file: "sfx-pass.mp3", at: l.at, volume: 0.32 })),
  },
  {
    id: "photo-finish",
    Scene: PhotoFinish,
    seconds: 13,
    voice: [{ id: "demo-09", at: 0.3 }],
    sfx: [
      { file: "sfx-whoosh.mp3", at: 0, volume: 0.35 },
      { file: "sfx-shutter.mp3", at: 9.98, volume: 0.6 },
    ],
  },
  { id: "challenge", Scene: SnipeUs, seconds: 12, voice: [{ id: "demo-10", at: 0.3 }] },
  { id: "agent", Scene: Agent, seconds: 11, voice: [{ id: "demo-11", at: 0.3 }] },
  // the bell rings as the mark appears; "Unison." follows it
  { id: "close", Scene: Close, seconds: 8, voice: [{ id: "demo-12", at: 0.9 }] },
];

/** music-demo.mp3's own landmarks (capture/music.mjs): its drop hits at 73.25 s, its closing bell at 229.86 s after
 * eight seconds falling away. The drop lands on the fill, the bell on the close. */
export const MUSIC_DEMO = { drop: 73.25, bell: 229.86, fall: 7.8 };
export const planDemo = () =>
  plan(DEMO, {
    file: "music-demo.mp3",
    drop: { track: MUSIC_DEMO.drop, beat: "live", at: LIVE_CUES.drop },
    end: { track: MUSIC_DEMO.bell, lead: MUSIC_DEMO.fall, beat: "close", at: 0.25 },
  });

export const Demo = (props: PlanProps) => <Film beats={DEMO} plan={props} music />;
