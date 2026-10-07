import { type Address, encodeFunctionData, erc20Abi, type Hex, parseAbi, parseEventLogs, type PublicClient } from "viem";
import { unisonExchangeAbi } from "@unison/sdk/abis/index.ts";
import { UnisonError, type Writer } from "./chain.ts";
import type { MarketState } from "./markets.ts";
import { buyLock, ceilDiv, fromUnits, tickAtOrAbove, tickAtOrBelow, toUnits } from "./units.ts";
import { exchange, type Market, type Token, tokens } from "./venue.ts";

export type Side = 0 | 1;
export const sideName = (s: Side) => (s === 0 ? "buy" : "sell");

export interface OrderPlan {
  market: Market;
  side: Side;
  qty: bigint;
  limitTick: bigint;
  /** quote units per base unit at the limit */
  limitPrice: bigint;
  /** what the order locks on the venue: quote units for a buy, base units for a sell */
  lock: bigint;
  maxFeeBps: bigint;
  baseUnit: bigint;
  /** Chainlink's newest observation when the order was planned */
  reference: bigint | null;
}

/**
 * The order to send: a quantity in base tokens and a limit, either given or set `slippageBps` past Chainlink's newest
 * observation (the auction still gives everyone in it one price, at the next observation; the limit only caps it).
 */
export function planOrder(s: MarketState, side: Side, qty: string, opts: { limit?: string; slippageBps?: number }): OrderPlan {
  const m = s.market;
  if (m.control) throw new UnisonError("UNISON_CONTROL_MARKET", `${m.symbol} is the standing challenge's control market, kept on the old rule`, "Trade WMON/AUSD (market 1) or aNVDA/AUSD (market 0).");
  if (s.halted || !s.active) throw new UnisonError("UNISON_MARKET_CLOSED", `${m.symbol} is not trading`, "`mm unison markets` shows each market's state.");
  const q = toUnits(qty, m.base.decimals);
  let price: bigint;
  if (opts.limit !== undefined) {
    price = toUnits(opts.limit, m.quote.decimals);
  } else {
    if (!s.reference) throw new UnisonError("UNISON_NO_REFERENCE", `${m.symbol} has no Chainlink observation to set a default limit from`, "Pass a limit: --limit <price>.");
    const slip = BigInt(Math.round((opts.slippageBps ?? 50) * 100));
    if (slip < 0n || slip > 100_000n) throw new UnisonError("UNISON_BAD_SLIPPAGE", "slippage must be between 0 and 1,000 bp", "For example --slippage 50.");
    // never more than the slippage past the observation: a buy's cap rounds down, a sell's floor rounds up
    price = side === 0 ? (s.reference.price * (1_000_000n + slip)) / 1_000_000n : ceilDiv(s.reference.price * (1_000_000n - slip), 1_000_000n);
  }
  const tick = side === 0 ? tickAtOrBelow(price, s.tickSize) : tickAtOrAbove(price, s.tickSize);
  if (tick < s.minTick || tick > s.maxTick) {
    throw new UnisonError("UNISON_LIMIT_OFF_GRID", `a limit of ${fromUnits(price, m.quote.decimals)} ${m.quote.symbol} is outside the market's price range`, "Pass a limit nearer the market: `mm unison quote` shows it.");
  }
  const limitPrice = tick * s.tickSize;
  const maxFeeBps = BigInt(s.maxFeeBps);
  return {
    market: m,
    side,
    qty: q,
    limitTick: tick,
    limitPrice,
    lock: side === 0 ? buyLock(q, limitPrice, maxFeeBps, s.baseUnit) : q,
    maxFeeBps,
    baseUnit: s.baseUnit,
    reference: s.reference?.price ?? null,
  };
}

export const venueBalance = (client: PublicClient, account: Address, token: Token) =>
  client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "balanceOf", args: [account, token.address] });

/** Refuses, before anything is signed, an order the venue balance can't cover. */
export async function checkCovered(client: PublicClient, account: Address, p: OrderPlan) {
  const token = p.side === 0 ? p.market.quote : p.market.base;
  const have = await venueBalance(client, account, token);
  if (have < p.lock) {
    const need = fromUnits(p.lock - have, token.decimals);
    throw new UnisonError(
      "UNISON_NOT_COVERED",
      `this ${sideName(p.side)} locks ${fromUnits(p.lock, token.decimals)} ${token.symbol} on Unison; the account has ${fromUnits(have, token.decimals)}`,
      `Deposit at least ${need} ${token.symbol} first: mm unison deposit ${need} ${token.symbol}`,
    );
  }
}

export interface Placed {
  hash: Hex;
  slot: bigint;
  /** the block the order was sealed in: its auction prices at the first Chainlink observation after this block's time */
  batch: bigint;
  block: bigint;
}

export async function placeOrder(w: Writer, p: OrderPlan): Promise<Placed> {
  const m = p.market;
  const limit = `${fromUnits(p.limitPrice, m.quote.decimals)} ${m.quote.symbol}`;
  const sent = await w.send({
    to: exchange,
    data: encodeFunctionData({ abi: unisonExchangeAbi, functionName: "placeOrder", args: [BigInt(m.id), BigInt(p.side), p.limitTick, p.qty, 1n] }),
    summary: `Unison: sealed ${sideName(p.side)} of ${fromUnits(p.qty, m.base.decimals)} ${m.base.symbol} at ${p.side === 0 ? "≤" : "≥"} ${limit}, priced at Chainlink's next observation`,
    details: { market: m.symbol, side: sideName(p.side), quantity: `${fromUnits(p.qty, m.base.decimals)} ${m.base.symbol}`, limit, contract: exchange },
  });
  const ev = parseEventLogs({ abi: unisonExchangeAbi, eventName: "OrderPlaced", logs: sent.receipt.logs }).find((l) => l.address.toLowerCase() === exchange.toLowerCase());
  if (!ev) throw new UnisonError("UNISON_NO_ORDER_EVENT", `no OrderPlaced in ${sent.hash}`, "Check the transaction on the explorer.");
  return { hash: sent.hash, slot: ev.args.slot, batch: ev.args.batch, block: sent.receipt.blockNumber };
}

export interface Auction {
  tx: Hex;
  block: bigint;
  upTo: bigint;
  tick: bigint;
  price: bigint;
  volume: bigint;
  refPrice: bigint;
  refTimeMs: bigint;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOG_SPAN = 100n; // blocks per log query: what public Monad RPCs answer

/** The auction that priced a batch: the first BatchCleared on its market with upToBlock at or after it. */
export async function findAuction(client: PublicClient, marketId: number, batch: bigint, fromBlock: bigint): Promise<Auction | null> {
  const head = await client.getBlockNumber();
  for (let from = fromBlock; from <= head; from += LOG_SPAN) {
    const to = from + LOG_SPAN - 1n < head ? from + LOG_SPAN - 1n : head;
    const logs = await client.getContractEvents({ address: exchange, abi: unisonExchangeAbi, eventName: "BatchCleared", args: { marketId: BigInt(marketId) }, fromBlock: from, toBlock: to });
    const hit = logs.find((l) => l.args.upToBlock! >= batch);
    if (hit) {
      const a = hit.args;
      return { tx: hit.transactionHash, block: hit.blockNumber, upTo: a.upToBlock!, tick: a.tick!, price: a.price!, volume: a.volume!, refPrice: a.refPrice!, refTimeMs: a.refTimeMs! };
    }
  }
  return null;
}

/** Waits until the market has cleared past the order's batch, then returns that auction. */
export async function awaitAuction(
  client: PublicClient,
  marketId: number,
  placed: Placed,
  opts: { timeoutMs?: number; pollMs?: number; onWait?: (sec: number) => void } = {},
): Promise<Auction> {
  const started = Date.now();
  const timeout = opts.timeoutMs ?? 180_000;
  for (;;) {
    const m = await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "market", args: [BigInt(marketId)] });
    if (m.lastCleared >= placed.batch) {
      const a = await findAuction(client, marketId, placed.batch, placed.block);
      if (a) return a;
    }
    if (Date.now() - started > timeout) {
      throw new UnisonError("UNISON_AUCTION_LATE", `the auction for the order sealed in block ${placed.batch} has not run within ${timeout / 1000} s`, "It runs at Chainlink's next observation. Check later with `mm unison balance`, then `mm unison claim`.");
    }
    opts.onWait?.(Math.round((Date.now() - started) / 1000));
    await sleep(opts.pollMs ?? 2_000);
  }
}

export interface Fill {
  claimTx: Hex;
  /** base units bought, or sold */
  base: bigint;
  /** quote units paid (fee included) for a buy, received (fee deducted) for a sell */
  quote: bigint;
  fee: bigint;
  /** who claimed it: the keeper does it for everyone within seconds, else the agent did */
  claimedBy: "keeper" | "agent";
}

const isOpen = async (client: PublicClient, account: Address, slot: bigint) =>
  ((await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "openOrderBitmap", args: [account] })) >> slot) & 1n;

/**
 * Settles the order once its auction has run: the keeper usually claims for everyone within seconds; if it hasn't,
 * the agent claims its own. Then reads what the claim paid out (the Claimed event).
 */
export async function settleOrder(w: Writer, p: OrderPlan, placed: Placed, opts: { keeperGraceMs?: number } = {}): Promise<Fill> {
  const grace = opts.keeperGraceMs ?? 8_000;
  const until = Date.now() + grace;
  let by: Fill["claimedBy"] = "keeper";
  while ((await isOpen(w.client, w.account, placed.slot)) === 1n && Date.now() < until) await sleep(1_500);
  if ((await isOpen(w.client, w.account, placed.slot)) === 1n) {
    await w.send({
      to: exchange,
      data: encodeFunctionData({ abi: unisonExchangeAbi, functionName: "claim", args: [w.account, [placed.slot]] }),
      summary: `Unison: claim the settled ${sideName(p.side)} order in slot ${placed.slot}`,
      details: { market: p.market.symbol, slot: placed.slot.toString(), contract: exchange },
    });
    by = "agent";
  }
  const c = await findClaim(w.client, p.market.id, w.account, placed.slot, placed.block);
  if (!c) throw new UnisonError("UNISON_NO_CLAIM_EVENT", `the order in slot ${placed.slot} settled, but its Claimed event wasn't found`, "`mm unison balance` shows the account's balances.");
  // a buy is credited its base and refunded what its lock didn't spend; a sell is paid its quote and returned unfilled base
  return p.side === 0
    ? { claimTx: c.tx, base: c.baseAmount, quote: p.lock - c.quoteAmount, fee: c.fee, claimedBy: by }
    : { claimTx: c.tx, base: p.qty - c.baseAmount, quote: c.quoteAmount, fee: c.fee, claimedBy: by };
}

/**
 * The Claimed event of an order, from the block it was placed in. A public RPC is many nodes, a block or two apart:
 * the one that just said the order is settled can be ahead of the one asked for the logs. So a miss is retried with
 * a fresh head for a few seconds, each pass reading the last few blocks again in case a lagging node answered them
 * empty.
 */
export async function findClaim(client: PublicClient, marketId: number, account: Address, slot: bigint, fromBlock: bigint, opts: { tries?: number; waitMs?: number } = {}) {
  let from = fromBlock;
  for (let attempt = 0; attempt < (opts.tries ?? 8); attempt++) {
    if (attempt > 0) await sleep(opts.waitMs ?? 1_500);
    const head = await client.getBlockNumber();
    for (let lo = from; lo <= head; lo += LOG_SPAN) {
      const hi = lo + LOG_SPAN - 1n < head ? lo + LOG_SPAN - 1n : head;
      const logs = await client.getContractEvents({ address: exchange, abi: unisonExchangeAbi, eventName: "Claimed", args: { marketId: BigInt(marketId), account }, fromBlock: lo, toBlock: hi });
      const c = logs.find((l) => l.args.slot === slot && l.blockNumber >= fromBlock);
      if (c) return { tx: c.transactionHash, block: c.blockNumber, baseAmount: c.args.baseAmount!, quoteAmount: c.args.quoteAmount!, fee: c.args.fee! };
    }
    if (head > from + 20n) from = head - 20n;
  }
  return null;
}

/** Wallet and venue balances for every listed token, plus native MON for gas. */
export async function balances(client: PublicClient, account: Address) {
  const rows = await Promise.all(
    tokens.map(async (t) => {
      const [wallet, venue] = await Promise.all([
        client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        venueBalance(client, account, t),
      ]);
      return { token: t.symbol, wallet: fromUnits(wallet, t.decimals), onUnison: fromUnits(venue, t.decimals) };
    }),
  );
  const mon = await client.getBalance({ address: account });
  const bitmap = await client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "openOrderBitmap", args: [account] });
  const openSlots: string[] = [];
  for (let i = 0n; i < 256n; i++) if ((bitmap >> i) & 1n) openSlots.push(i.toString());
  return { account, mon: fromUnits(mon, 18, 6), tokens: rows, openOrderSlots: openSlots };
}

/** Approves the exchange for exactly `amount` if needed, then deposits it to the agent's Unison balance. */
const wmonAbi = parseAbi(["function deposit() payable"]);
/** MON kept back from wrapping for the transactions that follow: Monad charges the gas limit, a few hundredths each. */
const GAS_RESERVE = 500_000_000_000_000_000n;

/**
 * Before a WMON deposit, wraps exactly the shortfall from the wallet's MON (WMON.deposit), keeping half a MON for gas.
 * Any other token must already be in the wallet.
 */
export async function ensureInWallet(w: Writer, token: Token, need: bigint): Promise<Hex | null> {
  const have = await w.client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [w.account] });
  if (have >= need) return null;
  if (token.symbol !== "WMON") {
    throw new UnisonError("UNISON_WALLET_SHORT", `the wallet has ${fromUnits(have, token.decimals)} ${token.symbol}`, `Fund the agent wallet with ${token.symbol} on Monad first.`);
  }
  const short = need - have;
  const mon = await w.client.getBalance({ address: w.account });
  if (mon < short + GAS_RESERVE) {
    throw new UnisonError("UNISON_WALLET_SHORT", `the wallet has ${fromUnits(have, 18)} WMON and ${fromUnits(mon, 18, 6)} MON; wrapping ${fromUnits(short, 18)} MON would leave too little for gas`, "Fund the agent wallet with more MON on Monad, or deposit less.");
  }
  const shown = fromUnits(short, 18);
  const sent = await w.send({
    to: token.address,
    data: encodeFunctionData({ abi: wmonAbi, functionName: "deposit" }),
    value: short,
    summary: `Unison: wrap ${shown} MON into WMON for a deposit`,
    details: { amount: `${shown} MON`, contract: token.address },
  });
  return sent.hash;
}

export async function deposit(w: Writer, token: Token, amount: string) {
  const v = toUnits(amount, token.decimals);
  const txs: Hex[] = [];
  const wrapped = await ensureInWallet(w, token, v);
  if (wrapped) txs.push(wrapped);
  const allowance = await w.client.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [w.account, exchange] });
  if (allowance < v) {
    const a = await w.send({
      to: token.address,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [exchange, v] }),
      summary: `Unison: let the exchange take exactly ${amount} ${token.symbol} for a deposit`,
      details: { token: token.symbol, amount, spender: exchange },
    });
    txs.push(a.hash);
  }
  const d = await w.send({
    to: exchange,
    data: encodeFunctionData({ abi: unisonExchangeAbi, functionName: "deposit", args: [token.address, v] }),
    summary: `Unison: deposit ${amount} ${token.symbol} to this wallet's Unison balance`,
    details: { token: token.symbol, amount, contract: exchange },
  });
  txs.push(d.hash);
  return { token: token.symbol, amount, onUnison: fromUnits(await venueBalance(w.client, w.account, token), token.decimals), transactions: txs };
}

/** Withdraws from the agent's Unison balance back to its wallet ("all" takes everything not locked in orders). */
export async function withdraw(w: Writer, token: Token, amount: string) {
  const have = await venueBalance(w.client, w.account, token);
  const v = amount.trim().toLowerCase() === "all" ? have : toUnits(amount, token.decimals);
  if (v === 0n) throw new UnisonError("UNISON_NOTHING_TO_WITHDRAW", `the Unison balance has no ${token.symbol}`, "`mm unison balance` shows what's there.");
  if (v > have) throw new UnisonError("UNISON_NOT_ENOUGH", `the Unison balance has ${fromUnits(have, token.decimals)} ${token.symbol}`, "Withdraw less, or `all`.");
  const shown = fromUnits(v, token.decimals);
  const sent = await w.send({
    to: exchange,
    data: encodeFunctionData({ abi: unisonExchangeAbi, functionName: "withdraw", args: [token.address, v, w.account] }),
    summary: `Unison: withdraw ${shown} ${token.symbol} to this wallet`,
    details: { token: token.symbol, amount: shown, to: w.account, contract: exchange },
  });
  return { token: token.symbol, amount: shown, transaction: sent.hash };
}

/** Claims every order slot of the agent's that has settled (its auction has run) and the keeper hasn't claimed. */
export async function claimSettled(w: Writer) {
  const bitmap = await w.client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "openOrderBitmap", args: [w.account] });
  const ready: bigint[] = [];
  for (let i = 0n; i < 256n; i++) {
    if (!((bitmap >> i) & 1n)) continue;
    const [merged, , , , closed] = await w.client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "previewOrder", args: [w.account, i] });
    if (merged && closed) ready.push(i);
  }
  if (ready.length === 0) return { claimed: [] as string[], transaction: null as Hex | null };
  const sent = await w.send({
    to: exchange,
    data: encodeFunctionData({ abi: unisonExchangeAbi, functionName: "claim", args: [w.account, ready] }),
    summary: `Unison: claim ${ready.length} settled order${ready.length === 1 ? "" : "s"}`,
    details: { slots: ready.join(", "), contract: exchange },
  });
  return { claimed: ready.map(String), transaction: sent.hash as Hex | null };
}
