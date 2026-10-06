import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { edgeBps, edgeOf, priceOf } from "../src/score.ts";

// Envio's codegen and test indexer run on Linux and macOS; score.test.ts covers the arithmetic on every platform. On CI
// these never skip, so a codegen that wrote nothing fails here instead of passing quietly.
const runs = process.env.CI === "true" || (process.platform !== "win32" && existsSync(new URL("../.envio", import.meta.url)));

const UNISON = "0xDcD3E86518db6A40C4feBa576efff598cA3B90d1"; // the LatencyChallenge on Unison's causal WMON market
const ACCOUNT = "0xB1964fD4521977d71FE058A8b96140faddB611b6"; // the house adversary's account on it
const OWNER = "0xcEc80166Ab48cb3C4ebD98671524761b1fd81276";
const AUSD_AGG = "0x7A0eC994Daec8DC342C101e9Bd5337A14FB39001";
const MON_AGG = "0x2A347b30e1DA22Ec136142cdA88Bec59fDB6e9d3";

// Monad mainnet, replayed block for block: the house adversary's first fill on Unison (its order sealed in auction
// 111,055,816), the AUSD/USD round in force over it, and the MON/USD rounds either side of its markout.
const QUOTE = { block: 111_049_356, round: 7_761n, answer: 99_985_245n, observedAt: 1791293104n };
const OPENED = { block: 111_054_706, logIndex: 86 };
const ORDER = { block: 111_055_816, logIndex: 459, slot: 0n, tick: 28_835n };
const FILL = { block: 111_055_894, logIndex: 202, placedAt: 1791295076n, side: 1n, base: 3_000_000_000_000_000_000n, quote: 86_799n };
const EARLY = { block: 111_055_976, round: 608_315n, answer: 2_896_810n, observedAt: 1791295112n }; // 36 s after the order: too soon
const MARK = { block: 111_056_072, round: 608_316n, answer: 2_903_000n, observedAt: 1791295142n }; // the first 60 s or more after it
const NEXT = { block: 111_056_168, round: 608_317n, answer: 2_903_800n, observedAt: 1791295172n };
const EXPECTED = edgeOf(1, FILL.base, FILL.quote, priceOf(MARK.answer, QUOTE.answer));

const transmission = (contract: "MonUsdAggregator" | "AusdUsdAggregator", r: { block: number; round: bigint; answer: bigint; observedAt: bigint }) => ({
  contract,
  event: "NewTransmission",
  srcAddress: contract === "MonUsdAggregator" ? MON_AGG : AUSD_AGG,
  block: { number: r.block },
  params: {
    aggregatorRoundId: r.round,
    answer: r.answer,
    transmitter: OWNER,
    observationsTimestamp: r.observedAt,
    observations: [r.answer],
    observers: "0x00",
    juelsPerFeeCoin: 0n,
    configDigest: `0x${"00".repeat(32)}`,
    epochAndRound: 0n,
  },
});
const opened = { contract: "LatencyChallenge", event: "Opened", srcAddress: UNISON, block: { number: OPENED.block }, logIndex: OPENED.logIndex, params: { owner: OWNER, account: ACCOUNT } };
const orderSent = {
  contract: "ChallengeAccount",
  event: "OrderSent",
  srcAddress: ACCOUNT,
  block: { number: ORDER.block },
  logIndex: ORDER.logIndex,
  params: { slot: ORDER.slot, side: FILL.side, tick: ORDER.tick, qty: FILL.base, placedAt: FILL.placedAt },
};
const fillRecorded = (block: number, logIndex: number) => ({
  contract: "ChallengeAccount",
  event: "FillRecorded",
  srcAddress: ACCOUNT,
  block: { number: block },
  logIndex,
  params: { index: 0n, placedAt: FILL.placedAt, side: FILL.side, base: FILL.base, quote: FILL.quote },
});

describe.skipIf(!runs)("the indexer, on Monad mainnet's own events", () => {
  it("registers the account from Opened, records its fill and marks it at its markout observation", async () => {
    const { createTestIndexer } = await import("envio");
    const indexer = createTestIndexer();
    // the factory pattern: the account exists for Envio only once Opened has registered it
    await indexer.process({ chains: { 143: { simulate: [transmission("AusdUsdAggregator", QUOTE), opened] } } } as never);
    await indexer.process({
      chains: { 143: { simulate: [orderSent, fillRecorded(FILL.block, FILL.logIndex), transmission("MonUsdAggregator", EARLY), transmission("MonUsdAggregator", MARK)] } },
    } as never);

    const challenge = await indexer.Challenge.getOrThrow(UNISON.toLowerCase());
    expect(challenge.rule).toBe("causal");
    const acc = await indexer.Account.getOrThrow(ACCOUNT.toLowerCase());
    expect(acc.challenge_id).toBe(UNISON.toLowerCase());
    expect(acc.owner).toBe(OWNER.toLowerCase());
    expect(acc.orders).toBe(1);
    expect(acc.fills).toBe(1);
    expect(acc.counted).toBe(1);
    expect(acc.pendingMarks).toBe(0);
    expect(acc.edge).toBe(EXPECTED);
    expect(acc.notional).toBe(FILL.quote);
    expect(acc.edgeBps).toBe(Number(edgeBps(EXPECTED, FILL.quote)));
    const fill = await indexer.Fill.getOrThrow(`${ACCOUNT.toLowerCase()}-0`);
    expect(fill.pending).toBe(false);
    expect(fill.markRound).toBe(MARK.round);
    expect(fill.markPrice).toBe(priceOf(MARK.answer, QUOTE.answer));
  });

  it("marks a late settle from the observation already on chain, not the newest one", async () => {
    const { createTestIndexer } = await import("envio");
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        143: {
          simulate: [
            transmission("AusdUsdAggregator", QUOTE),
            opened,
            transmission("MonUsdAggregator", EARLY),
            transmission("MonUsdAggregator", MARK),
            transmission("MonUsdAggregator", NEXT),
          ],
        },
      },
    } as never);
    // the same fill, recorded only after two observations that qualify have landed
    await indexer.process({ chains: { 143: { simulate: [fillRecorded(NEXT.block + 50, 0)] } } } as never);

    const acc = await indexer.Account.getOrThrow(ACCOUNT.toLowerCase());
    expect(acc.counted).toBe(1);
    expect(acc.pendingMarks).toBe(0);
    expect(acc.edge).toBe(EXPECTED);
    const fill = await indexer.Fill.getOrThrow(`${ACCOUNT.toLowerCase()}-0`);
    expect(fill.markRound).toBe(MARK.round);
  });
});
