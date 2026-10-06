/**
 * Builds test vectors for test/score.test.ts from Monad mainnet: for each of the house adversary's recorded fills, the
 * fill, its markout round and the AUSD/USD round in force (found by the SDK's scoreAccount), those rounds' answers,
 * and the contract's own edge (LatencyChallenge.edgeOf). Read-only.
 *
 *   node --conditions=development scripts/vectors.mjs > test/vectors.json
 */
import { createPublicClient, http, parseAbi } from "viem";
import { monad, scoreAccount, latencyChallengeAbi } from "@unison/sdk";

const c = createPublicClient({ chain: monad, transport: http("https://rpc.monad.xyz") });
const legs = [
  ["causal", "0xDcD3E86518db6A40C4feBa576efff598cA3B90d1", "0xB1964fD4521977d71FE058A8b96140faddB611b6"],
  ["old", "0x5Ce9D9f491E2d16c94F56eD09BEa23e7109976e9", "0xAc888Ed66Ba7599D89C59886E947A346D5a054f6"],
];
const feedAbi = parseAbi(["function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)"]);
const MON = "0xBcD78f76005B7515837af6b50c7C52BCf73822fb";
const AUSD = "0xE20751C7B5867bCBef815ffc1b284c3f412a9e13";
const out = [];
for (const [rule, challenge, account] of legs) {
  const s = await scoreAccount(c, challenge, account);
  const [edge, notional, fills] = await c.readContract({ address: challenge, abi: latencyChallengeAbi, functionName: "edgeOf", args: [account, s.baseRounds, s.quoteRounds] });
  const rows = [];
  for (const [i, f] of s.fills.entries()) {
    if (s.baseRounds[i] === 0n) continue;
    const [, b, bAt] = await c.readContract({ address: MON, abi: feedAbi, functionName: "getRoundData", args: [s.baseRounds[i]] });
    const [, q, qAt] = await c.readContract({ address: AUSD, abi: feedAbi, functionName: "getRoundData", args: [s.quoteRounds[i]] });
    rows.push({ placedAt: String(f.placedAt), side: f.side, base: String(f.base), quote: String(f.quote), markAnswer: String(b), markObservedAt: String(bAt), quoteAnswer: String(q), quoteObservedAt: String(qAt) });
  }
  out.push({ rule, challenge, account, contract: { edge: String(edge), notional: String(notional), fills: String(fills) }, rows });
}
console.log(JSON.stringify(out, null, 2));
