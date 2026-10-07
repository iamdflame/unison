import align from "../data/align.json";
import { type Beat, Film, plan, type PlanProps } from "../kit/Plan";
import { MmChallenge, MmClose, MmKeys, MmReceipt, MmSale, MmTitle } from "../scenes/bounty/MetaMask";
import { MUSIC_DEMO } from "./Demo";

/**
 * The MetaMask Agent Wallet plugin's bounty video (≤ 5:00; about 1:16): SCRIPT.md §6. Every terminal line is the
 * plugin's real output on Monad mainnet. Each scene sets its narration in its own type, so the film carries no
 * captions (the upload carries a subtitle file instead). The music is the demo's: it holds its breath while the
 * order is sealed and drops as Chainlink prices it; its last bell rings on "snipe us".
 */
// MmReceipt lands its six PASS lines evenly from line 1 + 0.4 s to line 3 − 0.3 s of mm-04
const RECEIPT_LINES = align["mm-04"].lines;
const PASS_SPAN = Math.max(0.3, (RECEIPT_LINES[3]!.from - RECEIPT_LINES[1]!.from - 0.7) / 6);

export const METAMASK: Beat[] = [
  { id: "mm-title", Scene: MmTitle, seconds: 9, captions: false, voice: [{ id: "mm-01", at: 0.4 }], sfx: [{ file: "sfx-pass.mp3", voice: "mm-01", line: 0, at: 0.85, volume: 0.28 }] },
  { id: "mm-keys", Scene: MmKeys, seconds: 12, captions: false, voice: [{ id: "mm-02", at: 0.4 }], sfx: [{ file: "sfx-pass.mp3", voice: "mm-02", line: 2, at: 2.2, volume: 0.32 }] },
  {
    id: "mm-sale",
    Scene: MmSale,
    seconds: 17,
    captions: false,
    voice: [{ id: "mm-03", at: 0.4 }],
    sfx: [
      { file: "sfx-seal.mp3", voice: "mm-03", line: 4, at: -0.1, volume: 0.5 },
      { file: "sfx-chime.mp3", voice: "mm-03", line: 5, at: 0.9, volume: 0.4 },
    ],
  },
  {
    id: "mm-receipt",
    Scene: MmReceipt,
    seconds: 10,
    captions: false,
    voice: [{ id: "mm-04", at: 0.4 }],
    // one hit for each PASS, as MmReceipt lands it
    sfx: [0, 1, 2, 3, 4, 5].map((k) => ({ file: "sfx-pass.mp3", voice: "mm-04" as const, line: 1, at: 0.4 + k * PASS_SPAN, volume: 0.26 })),
  },
  { id: "mm-challenge", Scene: MmChallenge, seconds: 15, captions: false, voice: [{ id: "mm-05", at: 0.4 }] },
  {
    id: "mm-close",
    Scene: MmClose,
    seconds: 10,
    captions: false,
    voice: [{ id: "mm-06", at: 0.4 }],
    sfx: [0, 1, 2].map((line) => ({ file: "sfx-pass.mp3", voice: "mm-06" as const, line, at: 0, volume: 0.24 })),
  },
];

export const planMetaMask = () =>
  plan(METAMASK, { file: "music-demo.mp3", gain: 0.85, drop: { track: MUSIC_DEMO.drop, beat: "mm-sale", voice: "mm-03", line: 5, at: 0.9 }, end: { track: MUSIC_DEMO.bell, lead: MUSIC_DEMO.fall, beat: "mm-close", voice: "mm-06", line: 4, at: 0 } });

export const MetaMask = (props: PlanProps) => <Film beats={METAMASK} plan={props} music />;
