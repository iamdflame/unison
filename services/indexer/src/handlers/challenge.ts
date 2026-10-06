/**
 * Envio HyperIndex handlers for Unison's standing challenge on Monad mainnet. The arithmetic lives in ../score.ts and is
 * unit-tested against the contract's own edgeOf; these handlers only move events into entities. Envio loads every file
 * under src/handlers/ on start.
 *
 *   LatencyChallenge.Opened      registers the new ChallengeAccount (factory pattern) and creates its Account
 *   LatencyChallenge.Claimed     marks the challenge paid
 *   ChallengeAccount.OrderSent   counts the account's orders
 *   ChallengeAccount.FillRecorded  records the fill, and marks it at once if its markout is already on chain (a late
 *                                settle)
 *   MonUsdAggregator.NewTransmission   stores the observation, then marks every waiting fill it is the markout of
 *   AusdUsdAggregator.NewTransmission  stores the AUSD/USD round, for the quote in force at each observation
 */
import { indexer, type Entity, type EvmOnEventContext } from "envio";
import { CHALLENGES, edgeBps, edgeOf, inWindow, marksFill, priceOf, TERMS } from "../score.ts";

type Ctx = EvmOnEventContext;
type FillRow = Entity<"Fill">;
type QuoteRow = Entity<"QuoteRound">;

const lower = (a: string) => a.toLowerCase();
/** How far forward a late fill looks for its markout: MON/USD's heartbeat is an hour, so it lands within 61 minutes. */
const MAX_SEARCH_MINUTES = 61n;

/** The AUSD/USD round in force at `t`: the newest observed at or before it. */
async function quoteAt(context: Ctx, t: bigint): Promise<QuoteRow | undefined> {
  const head = await context.Head.get("quote");
  let r = head ? await context.QuoteRound.get(head.round) : undefined;
  while (r && r.observedAt > t) r = r.previous ? await context.QuoteRound.get(r.previous) : undefined;
  return r;
}

/**
 * Marks one fill at its markout observation, and adds it to its account's score (edgeOf's arithmetic, in score.ts).
 * Only this observation may mark it, so a fill with no AUSD/USD round known is closed unpriced, never left for a later
 * observation to mark at the wrong price. The chain's start block makes that unreachable; it would show as fills >
 * counted.
 */
async function mark(context: Ctx, fill: FillRow, round: bigint, answer: bigint, observedAt: bigint) {
  const q = await quoteAt(context, observedAt);
  const acc = await context.Account.get(fill.account_id);
  if (!q) {
    context.log.error(`No AUSD/USD round in force at ${observedAt} for fill ${fill.id}: closed unpriced`);
    context.Fill.set({ ...fill, pending: false, markRound: round, markObservedAt: observedAt, markPrice: undefined, edge: undefined });
    if (acc) context.Account.set({ ...acc, pendingMarks: Math.max(0, acc.pendingMarks - 1) });
    return;
  }
  const price = priceOf(answer, q.answer);
  const e = edgeOf(fill.side, fill.base, fill.quote, price);
  context.Fill.set({ ...fill, pending: false, markRound: round, markObservedAt: observedAt, markPrice: price, edge: e });
  if (!acc) return;
  const edge = acc.edge + e;
  const notional = acc.notional + fill.quote;
  context.Account.set({
    ...acc,
    counted: acc.counted + 1,
    pendingMarks: Math.max(0, acc.pendingMarks - 1),
    edge,
    notional,
    edgeBps: Number(edgeBps(edge, notional)),
  });
}

indexer.contractRegister({ contract: "LatencyChallenge", event: "Opened" }, async ({ event, context }) => {
  context.chain.ChallengeAccount.add(event.params.account);
});

indexer.onEvent({ contract: "LatencyChallenge", event: "Opened" }, async ({ event, context }) => {
  const id = lower(event.srcAddress);
  const challenge = await context.Challenge.get(id);
  if (context.isPreload) return;
  if (!challenge) context.Challenge.set({ id, rule: CHALLENGES[id] ?? "unknown", paid: false, claimedBy: undefined, claimTx: undefined });
  context.Account.set({
    id: lower(event.params.account),
    challenge_id: id,
    owner: lower(event.params.owner),
    orders: 0,
    fills: 0,
    counted: 0,
    pendingMarks: 0,
    edge: 0n,
    notional: 0n,
    edgeBps: 0,
    lastPlacedAt: 0n,
  });
});

indexer.onEvent({ contract: "LatencyChallenge", event: "Claimed" }, async ({ event, context }) => {
  const id = lower(event.srcAddress);
  const challenge = await context.Challenge.get(id);
  if (context.isPreload) return;
  context.Challenge.set({
    ...(challenge ?? { id, rule: CHALLENGES[id] ?? "unknown", paid: false, claimedBy: undefined, claimTx: undefined }),
    paid: true,
    claimedBy: lower(event.params.owner),
    claimTx: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "ChallengeAccount", event: "OrderSent" }, async ({ event, context }) => {
  const acc = await context.Account.get(lower(event.srcAddress));
  if (context.isPreload || !acc) return;
  context.Account.set({ ...acc, orders: acc.orders + 1 });
});

indexer.onEvent({ contract: "ChallengeAccount", event: "FillRecorded" }, async ({ event, context }) => {
  const accountId = lower(event.srcAddress);
  const acc = await context.Account.get(accountId);
  const head = await context.Head.get("base");
  if (context.isPreload || !acc) return;
  const placedAt = event.params.placedAt;
  const counts = inWindow(placedAt);
  const fill: FillRow = {
    id: `${accountId}-${event.params.index}`,
    account_id: accountId,
    index: Number(event.params.index),
    placedAt,
    side: Number(event.params.side),
    base: event.params.base,
    quote: event.params.quote,
    inWindow: counts,
    pending: counts,
    markRound: undefined,
    markObservedAt: undefined,
    markPrice: undefined,
    edge: undefined,
  };
  context.Fill.set(fill);
  context.Account.set({ ...acc, fills: acc.fills + 1, pendingMarks: acc.pendingMarks + (counts ? 1 : 0), lastPlacedAt: placedAt });
  if (!counts || !head || !marksFill(head.observedAt, placedAt)) return;
  // A late settle: its markout is already on chain. Find the first observation after placedAt + horizonSec - 1,
  // minute by minute (each minute is indexed), up to MON/USD's heartbeat.
  const from = (placedAt + TERMS.horizonSec) / 60n;
  for (let m = from; m <= from + MAX_SEARCH_MINUTES; m++) {
    const first = (await context.Observation.getWhere({ minute: { _eq: m } }))
      .filter((o) => marksFill(o.observedAt, placedAt))
      .sort((a, b) => (a.observedAt < b.observedAt ? -1 : 1))[0];
    if (first) {
      await mark(context, fill, BigInt(first.id), first.answer, first.observedAt);
      return;
    }
  }
});

indexer.onEvent({ contract: "MonUsdAggregator", event: "NewTransmission" }, async ({ event, context }) => {
  const pending = await context.Fill.getWhere({ pending: { _eq: true } });
  if (context.isPreload) return;
  const round = event.params.aggregatorRoundId;
  const observedAt = event.params.observationsTimestamp;
  const answer = event.params.answer;
  context.Observation.set({ id: round.toString(), answer, observedAt, minute: observedAt / 60n });
  context.Head.set({ id: "base", round: round.toString(), observedAt });
  for (const f of pending) if (marksFill(observedAt, f.placedAt)) await mark(context, f, round, answer, observedAt);
});

indexer.onEvent({ contract: "AusdUsdAggregator", event: "NewTransmission" }, async ({ event, context }) => {
  const head = await context.Head.get("quote");
  if (context.isPreload) return;
  const id = event.params.aggregatorRoundId.toString();
  context.QuoteRound.set({ id, answer: event.params.answer, observedAt: event.params.observationsTimestamp, previous: head?.round });
  context.Head.set({ id: "quote", round: id, observedAt: event.params.observationsTimestamp });
});
