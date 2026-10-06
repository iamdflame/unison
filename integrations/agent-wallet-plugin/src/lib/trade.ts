import type { Writer } from "./chain.ts";
import type { MarketState } from "./markets.ts";
import { checkReceipt } from "./receipt.ts";
import { awaitAuction, checkCovered, placeOrder, planOrder, type Side, settleOrder, sideName } from "./trading.ts";
import { bpsFrom, fromUnits } from "./units.ts";
import { txUrl } from "./venue.ts";

export interface TradeOptions {
  limit?: string;
  slippageBps?: number;
  /** return once the order is sealed, without waiting for its auction */
  detach?: boolean;
  timeoutMs?: number;
  /** progress for a person watching: sealed, waiting, priced, settled */
  say?: (line: string) => void;
}

/**
 * One order, start to finish: sealed in a block, priced in an auction at Chainlink's first observation after that
 * block, settled, and its receipt checked from the chain alone, as anyone can check it.
 */
export async function trade(w: Writer, s: MarketState, side: Side, qty: string, o: TradeOptions = {}) {
  const say = o.say ?? (() => {});
  const m = s.market;
  const plan = planOrder(s, side, qty, o);
  await checkCovered(w.client, w.account, plan);
  const quantity = `${fromUnits(plan.qty, m.base.decimals)} ${m.base.symbol}`;
  const limit = `${fromUnits(plan.limitPrice, m.quote.decimals)} ${m.quote.symbol}`;
  const placed = await placeOrder(w, plan);
  const order = { market: m.symbol, side: sideName(side), quantity, limit, sealedInBlock: placed.batch.toString(), transaction: txUrl(placed.hash) };
  say(`Sealed in block ${placed.batch}. Its price doesn't exist yet: the auction prices at Chainlink's first observation after this block.`);
  if (o.detach) return { status: "sealed" as const, order, auction: null, fill: null, receipt: null };

  let last = 0;
  const auction = await awaitAuction(w.client, m.id, placed, {
    timeoutMs: o.timeoutMs,
    onWait: (sec) => {
      if (sec - last >= 10) {
        last = sec;
        say(`  waiting for Chainlink's next observation… ${sec} s`);
      }
    },
  });
  const auctionPrice = `${fromUnits(auction.price, m.quote.decimals)} ${m.quote.symbol}`;
  say(`Priced: ${auctionPrice}, one price for everyone in the auction (Chainlink: ${fromUnits(auction.refPrice, m.quote.decimals)}).`);
  const fill = await settleOrder(w, plan, placed);
  const receipt = await checkReceipt(w.client, auction.tx);
  say(`Receipt: ${receipt.passed} of ${receipt.of} checks pass against Chainlink's own history. ${receipt.receipt}`);
  const filled = fill.base > 0n;
  return {
    status: filled ? ("filled" as const) : ("not filled" as const),
    order,
    auction: {
      price: auctionPrice,
      chainlinkReference: `${fromUnits(auction.refPrice, m.quote.decimals)} ${m.quote.symbol}`,
      vsReferenceBps: bpsFrom(auction.price, auction.refPrice),
      upToBlock: auction.upTo.toString(),
      clearedInBlock: auction.block.toString(),
      observedAfterSealSec: receipt.chainlink?.observedAfterSealSec ?? null,
      transaction: txUrl(auction.tx),
    },
    fill: filled
      ? {
          [side === 0 ? "bought" : "sold"]: `${fromUnits(fill.base, m.base.decimals)} ${m.base.symbol}`,
          [side === 0 ? "paid" : "received"]: `${fromUnits(fill.quote, m.quote.decimals)} ${m.quote.symbol}`,
          fee: `${fromUnits(fill.fee, m.quote.decimals)} ${m.quote.symbol}`,
          claimedBy: fill.claimedBy,
          transaction: txUrl(fill.claimTx),
        }
      : { note: `it didn't fill in its auction (cleared at ${auctionPrice}, limit ${limit}); its funds came back whole`, transaction: txUrl(fill.claimTx) },
    receipt,
  };
}
