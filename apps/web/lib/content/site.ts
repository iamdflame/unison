import { archived } from "../venue/archive.ts";
import { facts } from "./facts.ts";

/** The beta's dates, as every sentence that names it says them. */
const BETA = `${facts.beta.from} to ${facts.beta.to}`;

/** Site-wide identity. Numbers live in facts.ts; words live next to the components that say them. */
export const site = {
  name: "Unison",
  tagline: "the market that never closes",
  description: archived
    ? `An exchange for tokenized stocks on Monad where every order is sealed before its price exists, so speed can't front-run you. Its mainnet beta ran from ${BETA}; the simulation runs in your browser.`
    : "Tokenized stocks on Monad, open every night and weekend. Every order in a batch clears at one price, so speed can't front-run you.",
  /** What the venue is today, said wherever the site invites someone to trade. One sentence, one source. */
  stage: archived ? "Beta concluded" : "Mainnet beta",
  disclosure: archived
    ? `The mainnet beta ran from ${BETA}, with real assets, small vaults and daily caps, and has concluded. Its contracts stay on Monad, verified, and its results are public. What runs on this site is the simulation: the real clearing engine in your browser, with a paper account. Never externally audited.`
    : "Live on Monad mainnet as a beta, with real assets, small vaults and daily caps, and on the testnet for practice. Not yet externally audited; until a 7-day timelock is in place, one team key administers the contracts. Not offered to US persons, a policy the beta does not enforce on chain.",
  /** said on the testnet's own screens */
  testnetDisclosure: "Monad testnet with mock assets: nothing here has value. Not yet externally audited.",
  /** said in the browser simulation */
  simulationDisclosure: archived
    ? `The simulation: the real clearing engine running in your browser, with a paper account. Nothing here is on a chain. The mainnet beta ran from ${BETA}.`
    : "The simulation: the real clearing engine running in your browser, with a paper account. Nothing here is on a chain.",
  /** said wherever the venue is on mainnet */
  mainnetDisclosure: "Monad mainnet, with real assets. A beta: small vaults and daily caps. Not yet externally audited; until a 7-day timelock is in place, one team key administers the contracts. Not offered to US persons (not enforced on chain).",
  /** the beta's dates, for the sentences that name it */
  beta: BETA,
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  repo: "https://github.com/iamdflame/unison",
} as const;
