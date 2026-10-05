/** Site-wide identity. Numbers live in facts.ts; words live next to the components that say them. */
export const site = {
  name: "Unison",
  tagline: "the market that never closes",
  description:
    "Tokenized stocks on Monad, open every night and weekend. Every order in a batch clears at one price, so speed can't front-run you.",
  /** What the venue is today, said wherever the site invites someone to trade. One sentence, one source. */
  stage: "Mainnet beta",
  disclosure: "Live on Monad mainnet as a beta, with real assets, small vaults and daily caps, and on the testnet for practice. Not yet externally audited. Not available to US persons.",
  /** said on the testnet's own screens */
  testnetDisclosure: "Monad testnet with mock assets: nothing here has value. Not yet externally audited.",
  /** said in the browser simulation */
  simulationDisclosure: "The simulation: the real clearing engine running in your browser, with a paper account. Nothing here is on a chain.",
  /** said wherever the venue is on mainnet */
  mainnetDisclosure: "Monad mainnet, with real assets. A beta: small vaults and daily caps. Not yet externally audited. Not available to US persons.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  repo: "https://github.com/iamdflame/unison",
} as const;
