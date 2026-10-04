/** Site-wide identity. Numbers live in facts.ts; words live next to the components that say them. */
export const site = {
  name: "Unison",
  tagline: "the market that never closes",
  description:
    "Tokenized stocks on Monad, open every night and weekend. Every order in a batch clears at one price, so speed can't front-run you.",
  /** What the venue is today, said wherever the site invites someone to trade. One sentence, one source. */
  stage: "Testnet",
  disclosure: "Monad testnet with mock assets. Not yet externally audited. Not available to US persons.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  repo: "https://github.com/iamdflame/unison",
} as const;
