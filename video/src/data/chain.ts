/**
 * Every number the film shows, with where it comes from. Nothing here is made up for the screen.
 */

/** The 13 seconds: apps/web/lib/content/facts.ts (causal), measured from Chainlink's MON/USD history on Monad. */
export const CAUSAL = {
  landsAfterSec: 13,
  skewSec: 2,
  waitP50Sec: 34,
  /** observations that moved more than the WMON vault's spread and fee */
  oldRuleGap: { overBps: 23, pctOfRounds: 6.1, perHour: 5.3 },
  roundsChecked: 8_100,
};

/** The first causal print on mainnet, and the same sale on the old rule: docs/evidence/mainnet.md. */
export const PHOTO_FINISH = {
  pair: "WMON/AUSD",
  quantity: "3 WMON",
  unison: {
    upTo: 111_055_816,
    sealedAt: "13:57:56",
    observedAt: "13:58:02",
    landedAt: "13:58:15",
    /** block 111,055,885 */
    clearedAt: "13:58:16",
    price: "0.028942",
    reference: "0.028994",
    tx: "0x128b8b18f4ae90cf0f79f439f5886f2f3ff548f2ebb3dcd7a847c2284351596e",
  },
  oldRule: {
    /** block 111,055,825: two seconds after the seal, four before Chainlink observed the move */
    filledAt: "13:57:58",
    price: "0.029059",
    /** the round already on chain, observed before the move */
    staleRound: "0.02912",
    tx: "0xa16a661d3d200629a1bf09de7348f1cf4702dec8302a680a90445cc85a33b180",
  },
  gapBps: 40,
  date: "6 October 2026",
};

/** The film's own trade, captured live (and at 4K) on www.unisonfi.com by capture/live.mjs: a passkey account buys
 * 9 WMON with its own AUSD on 7 October 2026. Every check of apps/web/scripts/verify-receipt.mjs passes
 * (src/data/verify-film-trade.txt). */
export const FILM_TRADE = {
  account: "0x686ec4AE35A0dDF9011eA6a864aEc6871d00F382",
  side: "buy",
  quantity: "9 WMON",
  limit: "0.027010",
  upTo: 111_237_596,
  sealedAt: "05:14:03",
  /** Chainlink's next observation: 24 s after the seal */
  observedAt: "05:14:27",
  /** its report on chain, 12 s after the observation */
  landedAt: "05:14:39",
  /** block 111,237,721 */
  clearedAt: "05:14:41",
  price: "0.026972",
  reference: "0.026915",
  paid: "0.24 AUSD",
  receiptHash: "0x209dc46107cea84b88bb2b1436d7a365aca6b30b5dd5879d4e24064314b2c01b",
  tx: "0x0e6ec0c81f3fed414507377584d7b279b90e1f44276a1af14a9a753e78aaaa3a",
  receipt: "https://www.unisonfi.com/receipt/mainnet/1/111237596",
};

/** The agent wallet's sale through MetaMask Agent Wallet: docs/evidence/agent-wallet.md. */
export const AGENT_SALE = {
  wallet: "0x5E986eC96d2979f278814452ad08c33C3c0AEA4b",
  command: "mm unison order WMON sell 10",
  intent: "Unison: sealed sell of 10 WMON at ≥ 0.028502 AUSD, priced at Chainlink's next observation",
  tx: "https://monadvision.com/tx/0xdeb070f9b98975fe8f2cf51b8f485876752a7d7169e1daa5e36a47bf119d7039",
  sealedBlock: 111_160_954,
  sealedAt: "22:48:23",
  observedAt: "22:48:31",
  landedAt: "22:48:44",
  price: "0.028605",
  reference: "0.028659",
  received: "0.285964 AUSD",
  receipt: "https://www.unisonfi.com/receipt/mainnet/1/111160954",
  seconds: 45,
  checks: [
    "PASS  receipt hash recomputes: 0x71bb199b56e60a9ca07afe3e4df2fd353b6d0f0c28f198949ce33ab8c98299e8",
    "PASS  the receipt's reference time is Chainlink's observation time (1791326911)",
    "PASS  observed strictly before the report landed on chain (a signed observation, not a block time)",
    "PASS  the newest order was sealed in block 111160954, at 1791326903",
    "PASS  observed 8 s after the seal (more than the 2 s skew)",
    "PASS  the round before it was observed at 1791326881, not after the seal: no earlier observation qualified",
  ],
};

/** The standing challenge: the pots, the house sniper's live score (the /challenge page and its Envio table, 7 October 04:02 UTC)
 * and its week-long replay (facts.challenge, docs/evidence/challenge.md). */
export const CHALLENGE = {
  pots: { causal: "18 AUSD", old: "1 AUSD" },
  live: { fills: 14, causalBps: -24.24, oldBps: 10.26 },
  replay: { trades: 208_414, rounds: 15_992, oldBps: 17.8, causalBps: -23.0, oldWinsPct: 72 },
  terms: { minFills: 30, epsilonBps: 2, horizonSec: 60 },
};

/** Monad: apps/web/lib/content/facts.ts. */
export const MONAD = { blockMs: 300, clearUsd: "0.02", orderUsd: "0.0005", gasSavedPct: 41 };

export const SITE = "unisonfi.com";
export const CHALLENGE_URL = "https://www.unisonfi.com/challenge";
