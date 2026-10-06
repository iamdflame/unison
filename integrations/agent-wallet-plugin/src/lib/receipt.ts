import type { Hex, PublicClient } from "viem";
import { unisonExchangeAbi } from "@unison/sdk/abis/index.ts";
import { verifyReceipt } from "@unison/sdk/verify.ts";
import { UnisonError } from "./chain.ts";
import { fromUnits } from "./units.ts";
import { exchange, markets, receiptUrl, txUrl } from "./venue.ts";

/**
 * Finds the transaction that finished an auction from what a person has: the transaction itself, the receipt link the
 * site shows (…/receipt/mainnet/1/111055816), or a market and the block its batch ran up to.
 */
export async function resolveClearTx(client: PublicClient, ref: string, upTo?: string): Promise<Hex> {
  const s = ref.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s as Hex;
  const m = s.match(/receipt\/(?:mainnet\/)?(\d+)\/(\d+)/) ?? (upTo ? [s, s, upTo] : null) ?? s.match(/^(\d+)[/:](\d+)$/);
  if (!m || !/^\d+$/.test(m[1]!) || !/^\d+$/.test(m[2]!)) {
    throw new UnisonError("UNISON_BAD_RECEIPT_REF", `"${ref}" is not a transaction, a receipt link or a market and block`, "Pass a clear transaction hash, a link like https://www.unisonfi.com/receipt/mainnet/1/111055816, or `1 111055816`.");
  }
  const marketId = BigInt(m[1]!);
  const block = BigInt(m[2]!);
  // BatchCleared indexes both the market and the block its batch ran up to; its auction clears minutes after at most
  const head = await client.getBlockNumber();
  for (let from = block; from <= head && from < block + 3_000n; from += 100n) {
    const to = from + 99n < head ? from + 99n : head;
    const logs = await client.getContractEvents({ address: exchange, abi: unisonExchangeAbi, eventName: "BatchCleared", args: { marketId, upToBlock: block }, fromBlock: from, toBlock: to });
    if (logs[0]) return logs[0].transactionHash;
  }
  throw new UnisonError("UNISON_NO_SUCH_AUCTION", `no auction on market ${marketId} ran up to block ${block}`, "Check the market and block in the receipt link.");
}

/** Every check of verify-receipt.mjs, as data: a person reads `checks`, an agent branches on `verified`. */
export async function checkReceipt(client: PublicClient, tx: Hex) {
  const v = await verifyReceipt(client, tx);
  const market = markets.find((x) => BigInt(x.id) === v.marketId);
  const price = (p: bigint) => (market ? `${fromUnits(p, market.quote.decimals)} ${market.quote.symbol}` : p.toString());
  return {
    verified: v.ok,
    market: market?.symbol ?? v.marketId.toString(),
    auction: { upToBlock: v.upToBlock.toString(), clearedInBlock: v.clearedInBlock.toString(), price: price(v.price), volume: market ? `${fromUnits(v.volume, market.base.decimals)} ${market.base.symbol}` : v.volume.toString() },
    chainlink: v.causal
      ? { feed: v.causal.feed, round: v.causal.round.toString(), observedAt: new Date(Number(v.causal.observedAt) * 1000).toISOString(), landedOnChainAt: new Date(Number(v.causal.landedAt) * 1000).toISOString(), sealedAt: new Date(Number(v.causal.sealedAt) * 1000).toISOString(), observedAfterSealSec: Number(v.causal.observedAt - v.causal.sealedAt) }
      : null,
    checks: v.steps.filter((s) => s.kind !== "info").map((s) => (s.kind === "check" ? `${s.ok ? "PASS" : "FAIL"}  ${s.what}` : `${s.kind === "skip" ? "SKIP" : "note"}  ${s.what}`)),
    passed: v.checks - v.failures,
    of: v.checks,
    receipt: receiptUrl(v.marketId, v.upToBlock),
    transaction: txUrl(tx),
  };
}
