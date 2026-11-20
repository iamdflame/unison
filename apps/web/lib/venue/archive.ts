/**
 * The public beta (Monad mainnet and the public testnet) ran from 5 October to 18 November 2026, and its servers are
 * off. An archived build serves the record instead of a venue: the simulation in the browser, the beta's results, and
 * its receipts, each still checked against the chain by the reader's own browser. No page of it waits on a tape, a
 * relayer or a scoreboard.
 *
 * Archived is the default. NEXT_PUBLIC_ARCHIVE=0 brings the configured networks back with no code change, and a build
 * for a local devnet is never archived. This module imports nothing, so copy can read it without pulling in the venue.
 */
const local = process.env.NEXT_PUBLIC_NETWORK === "devnet" || process.env.NEXT_PUBLIC_CHAIN_ID === "31337";

export const archived = process.env.NEXT_PUBLIC_ARCHIVE !== "0" && !local;
