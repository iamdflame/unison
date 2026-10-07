import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { CreClose, CreFlow, CreRule, CreSim, CreWhy } from "../scenes/bounty/Cre";

/**
 * The Chainlink CRE sentinel's bounty video (≤ 2:00): SCRIPT.md §6. The heartbeat is the feed's real rounds; the
 * terminal is the CRE simulator against Monad mainnet; the rule is the workflow's own, with its tests' cases.
 */
export const CRE: Beat[] = [
  { id: "cre-why", Scene: CreWhy, seconds: 13, voice: [{ id: "cre-01", at: 0.4 }] },
  { id: "cre-flow", Scene: CreFlow, seconds: 12, voice: [{ id: "cre-02", at: 0.4 }] },
  { id: "cre-rule", Scene: CreRule, seconds: 12, voice: [{ id: "cre-03", at: 0.4 }] },
  { id: "cre-sim", Scene: CreSim, seconds: 15, voice: [{ id: "cre-04", at: 0.4 }] },
  { id: "cre-close", Scene: CreClose, seconds: 9, voice: [{ id: "cre-05", at: 0.4 }] },
];

export const planCre = () => plan(CRE, "music-pitch.mp3");

export const Cre = (props: PlanProps) => <Film beats={CRE} plan={props} music />;
