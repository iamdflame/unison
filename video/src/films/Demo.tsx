import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { Agent } from "../scenes/Agent";
import { Challenge } from "../scenes/Challenge";
import { Close } from "../scenes/Close";
import { ColdOpen } from "../scenes/ColdOpen";
import { Idea } from "../scenes/Idea";
import { Live, LIVE_CUES, LIVE_SECONDS } from "../scenes/Live";
import { PhotoFinish } from "../scenes/PhotoFinish";
import { Thirteen } from "../scenes/Thirteen";
import { Verify, VERIFY_LINES } from "../scenes/Verify";

/**
 * The demo (≤ 3:00), "The thirteen seconds": SCRIPT.md §2. The voice lines land where the picture earns them:
 * "Sell some MON" as the ticket opens, "There." on the fill, one rimshot per PASS.
 */
export const DEMO: Beat[] = [
  {
    id: "cold-open",
    Scene: ColdOpen,
    seconds: 12,
    voice: [{ id: "demo-01", at: 0.9 }],
    sfx: [0, 0.3, 0.6, 0.9, 1.2, 1.5].map((at) => ({ file: "sfx-tick.mp3", at, volume: 0.32 })),
  },
  { id: "thirteen", Scene: Thirteen, seconds: 14, voice: [{ id: "demo-02", at: 0.4 }] },
  {
    id: "idea",
    Scene: Idea,
    seconds: 12,
    voice: [{ id: "demo-03", at: 0.3 }],
    sfx: [
      { file: "sfx-seal.mp3", at: 2.4, volume: 0.7 },
      { file: "sfx-chime.mp3", at: 6.6, volume: 0.45 },
    ],
  },
  {
    id: "live",
    Scene: Live,
    seconds: LIVE_SECONDS,
    fixed: true,
    voice: [
      { id: "demo-04", at: 0.5 },
      { id: "demo-05", at: LIVE_CUES.sell + 0.5 },
      { id: "demo-06", at: LIVE_CUES.drop - 0.1 },
    ],
    sfx: [
      { file: "sfx-seal.mp3", at: LIVE_CUES.sealed, volume: 0.6 },
      { file: "sfx-chime.mp3", at: LIVE_CUES.drop, volume: 0.6 },
    ],
  },
  {
    id: "verify",
    Scene: Verify,
    seconds: 12,
    voice: [{ id: "demo-07", at: 0.2 }],
    sfx: VERIFY_LINES.filter((l) => l.kind === "pass").map((l) => ({ file: "sfx-pass.mp3", at: l.at, volume: 0.5 })),
  },
  {
    id: "photo-finish",
    Scene: PhotoFinish,
    seconds: 13,
    voice: [{ id: "demo-08", at: 0.3 }],
    sfx: [
      { file: "sfx-whoosh.mp3", at: 0, volume: 0.4 },
      { file: "sfx-shutter.mp3", at: 9.98, volume: 0.7 },
    ],
  },
  { id: "challenge", Scene: Challenge, seconds: 8, voice: [{ id: "demo-09", at: 0.3 }] },
  { id: "agent", Scene: Agent, seconds: 11, voice: [{ id: "demo-10", at: 0.3 }] },
  { id: "close", Scene: Close, seconds: 8, voice: [{ id: "demo-11", at: 0.4 }] },
];

export const planDemo = () => plan(DEMO, "music-demo.mp3");

export const Demo = (props: PlanProps) => <Film beats={DEMO} plan={props} music />;
