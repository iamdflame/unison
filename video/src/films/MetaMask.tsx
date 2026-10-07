import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { MmChallenge, MmClose, MmKeys, MmReceipt, MmSale, MmTitle } from "../scenes/bounty/MetaMask";

/**
 * The MetaMask Agent Wallet plugin's bounty video (≤ 5:00; about two minutes): SCRIPT.md §6. Every terminal line is
 * the plugin's real output on Monad mainnet.
 */
export const METAMASK: Beat[] = [
  { id: "mm-title", Scene: MmTitle, seconds: 9, voice: [{ id: "mm-01", at: 0.4 }] },
  { id: "mm-keys", Scene: MmKeys, seconds: 12, voice: [{ id: "mm-02", at: 0.4 }] },
  { id: "mm-sale", Scene: MmSale, seconds: 17, voice: [{ id: "mm-03", at: 0.4 }] },
  { id: "mm-receipt", Scene: MmReceipt, seconds: 10, voice: [{ id: "mm-04", at: 0.4 }], sfx: [] },
  { id: "mm-challenge", Scene: MmChallenge, seconds: 15, voice: [{ id: "mm-05", at: 0.4 }] },
  { id: "mm-close", Scene: MmClose, seconds: 10, voice: [{ id: "mm-06", at: 0.4 }] },
];

export const planMetaMask = () => plan(METAMASK, "music-pitch.mp3");

export const MetaMask = (props: PlanProps) => <Film beats={METAMASK} plan={props} music />;
