import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { CreClose, CreFlow, CreRule, CreSim, CreWhy } from "../scenes/bounty/Cre";
import { MUSIC_DEMO } from "./Demo";

/**
 * The Chainlink CRE sentinel's bounty video (≤ 2:00; about 1:03): SCRIPT.md §6. The heartbeat is the feed's real
 * rounds; the terminal is the CRE simulator against Monad mainnet; the rule is the workflow's own, with its tests'
 * cases. No captions: each scene sets its narration in its own type (the upload carries a subtitle file). The music
 * holds its breath over the simulator's reading and drops on its verdict; the last bell rings on the guardian.
 */
export const CRE: Beat[] = [
  { id: "cre-why", Scene: CreWhy, seconds: 13, captions: false, voice: [{ id: "cre-01", at: 0.4 }] },
  { id: "cre-flow", Scene: CreFlow, seconds: 13.4, captions: false, voice: [{ id: "cre-02", at: 0.4 }], sfx: [{ file: "sfx-tick.mp3", voice: "cre-02", line: 1, at: -0.3, volume: 0.45 }] },
  { id: "cre-rule", Scene: CreRule, seconds: 12, captions: false, voice: [{ id: "cre-03", at: 0.4 }], sfx: [{ file: "sfx-seal.mp3", voice: "cre-03", line: 1, at: 0.7, volume: 0.5 }] },
  {
    id: "cre-sim",
    Scene: CreSim,
    seconds: 15,
    captions: false,
    voice: [{ id: "cre-04", at: 0.4 }],
    sfx: [
      { file: "sfx-pass.mp3", voice: "cre-04", line: 3, at: 0, volume: 0.32 },
      { file: "sfx-seal.mp3", voice: "cre-04", line: 5, at: 0.5, volume: 0.55 },
    ],
  },
  { id: "cre-close", Scene: CreClose, seconds: 9, captions: false, voice: [{ id: "cre-05", at: 0.4 }] },
];

export const planCre = () =>
  plan(CRE, { file: "music-demo.mp3", gain: 0.85, drop: { track: MUSIC_DEMO.drop, beat: "cre-sim", voice: "cre-04", line: 3, at: 0 }, end: { track: MUSIC_DEMO.bell, lead: MUSIC_DEMO.fall, beat: "cre-close", voice: "cre-05", line: 2, at: 0 } });

export const Cre = (props: PlanProps) => <Film beats={CRE} plan={props} music />;
