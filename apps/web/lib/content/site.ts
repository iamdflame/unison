/** Site-wide identity. Numbers live in facts.ts; words live next to the components that say them. */
export const site = {
  name: "Unison",
  tagline: "the market that never closes",
  description:
    "Every 300 milliseconds, every order clears at one fair price. Tokenized stocks on Monad, open every night and weekend, and built so speed can't front-run you.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  repo: "https://github.com/iamdflame/unison",
} as const;
