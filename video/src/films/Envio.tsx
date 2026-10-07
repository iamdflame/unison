import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { EnvioBoard, EnvioFlow, EnvioOpen, EnvioTests } from "../scenes/bounty/Envio";
import { MUSIC_DEMO } from "./Demo";

/**
 * The Envio indexer's bounty video (≤ 2:00; about 0:48): SCRIPT.md §6. The factory registration, the markouts from the
 * feed's own events, the live leaderboard checked against the contract, and the CI run that replays mainnet. Captions
 * only over the footage; the drawn scenes set their narration in their own type. The music drops on the leaderboard;
 * its last bell rings on "snipe us".
 */
export const ENVIO: Beat[] = [
  { id: "envio-open", Scene: EnvioOpen, seconds: 10, captions: false, voice: [{ id: "envio-01", at: 0.4 }] },
  { id: "envio-flow", Scene: EnvioFlow, seconds: 16, captions: false, voice: [{ id: "envio-02", at: 0.4 }], sfx: [{ file: "sfx-pass.mp3", voice: "envio-02", line: 1, at: 0.35, volume: 0.3 }, { file: "sfx-tick.mp3", voice: "envio-02", line: 3, at: 2.2, volume: 0.4 }] },
  { id: "envio-board", Scene: EnvioBoard, seconds: 11, voice: [{ id: "envio-03", at: 0.4 }] },
  { id: "envio-tests", Scene: EnvioTests, seconds: 8, captions: false, voice: [{ id: "envio-04", at: 0.4 }], sfx: [{ file: "sfx-pass.mp3", at: 0.35 + 6 * 0.15, volume: 0.36 }] },
];

export const planEnvio = () =>
  plan(ENVIO, { file: "music-demo.mp3", gain: 0.85, drop: { track: MUSIC_DEMO.drop, beat: "envio-board", at: 0.1 }, end: { track: MUSIC_DEMO.bell, lead: MUSIC_DEMO.fall, beat: "envio-tests", voice: "envio-04", line: 1, at: 0 } });

export const Envio = (props: PlanProps) => <Film beats={ENVIO} plan={props} music />;
