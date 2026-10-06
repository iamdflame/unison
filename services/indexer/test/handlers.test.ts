import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { edgeOf, priceOf } from "../src/score.ts";

// Envio's codegen and test indexer run on Linux only (CI runs them); score.test.ts covers the arithmetic everywhere.
const runs = process.platform !== "win32" && existsSync(new URL("../generated", import.meta.url));

const UNISON = "0xDcD3E86518db6A40C4feBa576efff598cA3B90d1" as const;
const ACCOUNT = "0xB1964fD4521977d71FE058A8b96140faddB611b6" as const;
const OWNER = "0xcEc80166Ab48cb3C4ebD98671524761b1fd81276" as const;
const AUSD_AGG = "0x7A0eC994Daec8DC342C101e9Bd5337A14FB39001" as const;
const MON_AGG = "0x2A347b30e1DA22Ec136142cdA88Bec59fDB6e9d3" as const;
// the house adversary's first fill on mainnet, its markout round and the AUSD/USD round in force (test/vectors.json)
const FILL = { placedAt: 1791295076n, side: 1n, base: 3_000_000_000_000_000_000n, quote: 86_799n };
const QUOTE = { round: 4_242n, answer: 99_985_245n, observedAt: 1791293104n };
const MARK = { round: 608_316n, answer: 2_903_000n, observedAt: 1791295142n };
const EXPECTED = edgeOf(1, FILL.base, FILL.quote, priceOf(MARK.answer, QUOTE.answer));

const transmission = (round: bigint, answer: bigint, observedAt: bigint) => ({
  aggregatorRoundId: round,
  answer,
  transmitter: OWNER,
  observationsTimestamp: observedAt,
  observations: [answer],
  observers: "0x00",
  juelsPerFeeCoin: 0n,
  configDigest: `0x${"00".repeat(32)}`,
  epochAndRound: 0n,
});

describe.skipIf(!runs)("the indexer, end to end on simulated events", () => {
  it("registers the account, records the fill and marks it at its markout observation", async () => {
    const { createTestIndexer } = await import("envio");
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        143: {
          simulate: [
            { contract: "AusdUsdAggregator", event: "NewTransmission", srcAddress: AUSD_AGG, params: transmission(QUOTE.round, QUOTE.answer, QUOTE.observedAt) },
            { contract: "LatencyChallenge", event: "Opened", srcAddress: UNISON, params: { owner: OWNER, account: ACCOUNT } },
            { contract: "ChallengeAccount", event: "OrderSent", srcAddress: ACCOUNT, params: { slot: 0n, side: 1n, tick: 28_835n, qty: FILL.base, placedAt: FILL.placedAt } },
            { contract: "ChallengeAccount", event: "FillRecorded", srcAddress: ACCOUNT, params: { index: 0n, ...FILL } },
            // an observation too early to mark it, then its markout
            { contract: "MonUsdAggregator", event: "NewTransmission", srcAddress: MON_AGG, params: transmission(MARK.round - 1n, 2_899_000n, FILL.placedAt + 6n) },
            { contract: "MonUsdAggregator", event: "NewTransmission", srcAddress: MON_AGG, params: transmission(MARK.round, MARK.answer, MARK.observedAt) },
          ],
        },
      },
    } as never);
    const acc = await indexer.Account.getOrThrow(ACCOUNT.toLowerCase());
    expect(acc.challenge_id).toBe(UNISON.toLowerCase());
    expect(acc.orders).toBe(1);
    expect(acc.fills).toBe(1);
    expect(acc.counted).toBe(1);
    expect(acc.pendingMarks).toBe(0);
    expect(acc.edge).toBe(EXPECTED);
    expect(acc.notional).toBe(FILL.quote);
    const fill = await indexer.Fill.getOrThrow(`${ACCOUNT.toLowerCase()}-0`);
    expect(fill.markRound).toBe(MARK.round);
    expect(fill.pending).toBe(false);
    const challenge = await indexer.Challenge.getOrThrow(UNISON.toLowerCase());
    expect(challenge.rule).toBe("causal");
  });

  it("marks a late settle from an observation already on chain", async () => {
    const { createTestIndexer } = await import("envio");
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        143: {
          simulate: [
            { contract: "AusdUsdAggregator", event: "NewTransmission", srcAddress: AUSD_AGG, params: transmission(QUOTE.round, QUOTE.answer, QUOTE.observedAt) },
            { contract: "LatencyChallenge", event: "Opened", srcAddress: UNISON, params: { owner: OWNER, account: ACCOUNT } },
            { contract: "MonUsdAggregator", event: "NewTransmission", srcAddress: MON_AGG, params: transmission(MARK.round, MARK.answer, MARK.observedAt) },
            { contract: "MonUsdAggregator", event: "NewTransmission", srcAddress: MON_AGG, params: transmission(MARK.round + 1n, 2_950_000n, MARK.observedAt + 40n) },
            { contract: "ChallengeAccount", event: "FillRecorded", srcAddress: ACCOUNT, params: { index: 0n, ...FILL } },
          ],
        },
      },
    } as never);
    const acc = await indexer.Account.getOrThrow(ACCOUNT.toLowerCase());
    expect(acc.counted).toBe(1);
    expect(acc.edge).toBe(EXPECTED);
  });
});
