import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { EnvioBoard, EnvioFlow, EnvioOpen, EnvioTests } from "../scenes/bounty/Envio";

/**
 * The Envio indexer's bounty video (≤ 2:00): SCRIPT.md §6. The factory registration, the markouts from the feed's own
 * events, the live leaderboard, and the CI run that replays mainnet.
 */
export const ENVIO: Beat[] = [
  { id: "envio-open", Scene: EnvioOpen, seconds: 10, voice: [{ id: "envio-01", at: 0.4 }] },
  { id: "envio-flow", Scene: EnvioFlow, seconds: 16, voice: [{ id: "envio-02", at: 0.4 }] },
  { id: "envio-board", Scene: EnvioBoard, seconds: 11, voice: [{ id: "envio-03", at: 0.4 }] },
  { id: "envio-tests", Scene: EnvioTests, seconds: 8, voice: [{ id: "envio-04", at: 0.4 }] },
];

export const planEnvio = () => plan(ENVIO, "music-pitch.mp3");

export const Envio = (props: PlanProps) => <Film beats={ENVIO} plan={props} music />;
