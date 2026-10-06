import { type Address, encodeFunctionData, erc20Abi, type Hex, parseEventLogs, type PublicClient } from "viem";
import { challengeAccountAbi, latencyChallengeAbi, unisonExchangeAbi } from "@unison/sdk/abis/index.ts";
import { challengeTerms, scoreAccount } from "@unison/sdk/challenge.ts";
import { explainRevert, UnisonError, type Writer } from "./chain.ts";
import { readMarket } from "./markets.ts";
import { planOrder, type Side, sideName } from "./trading.ts";
import { fromUnits, toUnits } from "./units.ts";
import { challenges, exchange, markets, type Token, tokens } from "./venue.ts";

/**
 * The standing challenge (contracts/src/challenge): a pot for any account whose fills, each marked to the first
 * Chainlink observation at least a minute after its order, show an edge after fees over enough fills. One pot runs on
 * Unison's causal market, one on a control market kept on the old rule, so the definition is shown to bite where there
 * is an edge. Every order goes through the challenger's own ChallengeAccount, which records every fill.
 */
export type Rule = "causal" | "old";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ruleOf(name: string | undefined): Rule {
  const n = (name ?? "causal").trim().toLowerCase();
  if (n === "causal" || n === "unison") return "causal";
  if (n === "old" || n === "control" || n === "old-rule") return "old";
  throw new UnisonError("UNISON_BAD_RULE", `"${name}" is not a challenge`, "Use --rule causal (Unison's market) or --rule old (the control).");
}

export async function accountOf(client: PublicClient, rule: Rule, owner: Address): Promise<Address | null> {
  const a = await client.readContract({ address: challenges[rule], abi: latencyChallengeAbi, functionName: "accountOf", args: [owner] });
  return a === ZERO ? null : a;
}

async function requireAccount(w: Writer, rule: Rule): Promise<Address> {
  const a = await accountOf(w.client, rule, w.account);
  if (!a) throw new UnisonError("UNISON_NO_CHALLENGE_ACCOUNT", `this wallet has no account on the ${rule} challenge`, `Open one first: mm unison challenge open --rule ${rule}`);
  return a;
}

const marketOfRule = async (client: PublicClient, rule: Rule) => {
  const id = Number(await client.readContract({ address: challenges[rule], abi: latencyChallengeAbi, functionName: "marketId" }));
  const m = markets.find((x) => x.id === id);
  if (!m) throw new Error(`the ${rule} challenge trades market ${id}, which isn't in the deployment record`);
  return m;
};

export async function openAccount(w: Writer, rule: Rule) {
  const c = challenges[rule];
  if (await w.client.readContract({ address: c, abi: latencyChallengeAbi, functionName: "isTeam", args: [w.account] })) {
    throw new UnisonError("UNISON_TEAM", "this wallet belongs to the Unison team, whose fills are not the challenge", "Use another wallet.");
  }
  const existing = await accountOf(w.client, rule, w.account);
  if (existing) return { rule, account: existing, transaction: null as Hex | null, opened: false };
  const sent = await w.send({
    to: c,
    data: encodeFunctionData({ abi: latencyChallengeAbi, functionName: "open" }),
    summary: `Unison challenge: open a trading account on the ${rule === "causal" ? "causal (Unison)" : "old-rule (control)"} challenge`,
    details: { challenge: c, rule },
  });
  const ev = parseEventLogs({ abi: latencyChallengeAbi, eventName: "Opened", logs: sent.receipt.logs }).find((l) => l.address.toLowerCase() === c.toLowerCase());
  if (!ev) throw new UnisonError("UNISON_NO_OPENED_EVENT", `no Opened in ${sent.hash}`, "Check the transaction on the explorer.");
  return { rule, account: ev.args.account, transaction: sent.hash as Hex | null, opened: true };
}

/** Moves the owner's tokens into the challenge account's Unison balance (approving the account first, exactly). */
export async function fund(w: Writer, rule: Rule, token: Token, amount: string) {
  const account = await requireAccount(w, rule);
  const v = toUnits(amount, token.decimals);
  const txs: Hex[] = [];
  const allowance = await w.client.readContract({ address: token.address, abi: erc20Abi, functionName: "allowance", args: [w.account, account] });
  if (allowance < v) {
    txs.push(
      (
        await w.send({
          to: token.address,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [account, v] }),
          summary: `Unison challenge: let your challenge account take exactly ${amount} ${token.symbol}`,
          details: { token: token.symbol, amount, spender: account },
        })
      ).hash,
    );
  }
  txs.push(
    (
      await w.send({
        to: account,
        data: encodeFunctionData({ abi: challengeAccountAbi, functionName: "deposit", args: [token.address, v] }),
        summary: `Unison challenge: deposit ${amount} ${token.symbol} into your challenge account`,
        details: { token: token.symbol, amount, account },
      })
    ).hash,
  );
  const balance = await w.client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "balanceOf", args: [account, token.address] });
  return { rule, account, token: token.symbol, amount, accountBalance: fromUnits(balance, token.decimals), transactions: txs };
}

/** Sends one sealed IOC order through the challenge account. Its fill is recorded when it is settled. */
export async function challengeOrder(w: Writer, rule: Rule, side: Side, qty: string, opts: { limit?: string; slippageBps?: number }) {
  const account = await requireAccount(w, rule);
  if (await w.client.readContract({ address: account, abi: challengeAccountAbi, functionName: "orderOpen" })) {
    throw new UnisonError("UNISON_ORDER_IN_FLIGHT", "the challenge account has an order in flight", `Settle it first: mm unison challenge settle --rule ${rule}`);
  }
  const market = await marketOfRule(w.client, rule);
  const state = await readMarket(w.client, market);
  // the control market has no causal reference of its own; both read the same Chainlink MON/USD feed
  const reference = state.reference ?? (await readMarket(w.client, markets.find((m) => m.causal && m.base.address === market.base.address) ?? market)).reference;
  const plan = planOrder({ ...state, reference, market: { ...market, control: false } }, side, qty, opts);
  const lockToken = side === 0 ? market.quote : market.base;
  const have = await w.client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "balanceOf", args: [account, lockToken.address] });
  if (have < plan.lock) {
    const need = fromUnits(plan.lock - have, lockToken.decimals);
    throw new UnisonError("UNISON_NOT_COVERED", `this ${sideName(side)} locks ${fromUnits(plan.lock, lockToken.decimals)} ${lockToken.symbol}; the challenge account has ${fromUnits(have, lockToken.decimals)}`, `Fund it: mm unison challenge fund ${need} ${lockToken.symbol} --rule ${rule}`);
  }
  const limit = `${fromUnits(plan.limitPrice, market.quote.decimals)} ${market.quote.symbol}`;
  const sent = await w.send({
    to: account,
    data: encodeFunctionData({ abi: challengeAccountAbi, functionName: "order", args: [side, plan.limitTick, plan.qty] }),
    summary: `Unison challenge: sealed ${sideName(side)} of ${fromUnits(plan.qty, market.base.decimals)} ${market.base.symbol} at ${side === 0 ? "≤" : "≥"} ${limit} on the ${rule} market`,
    details: { account, market: market.symbol, side: sideName(side), quantity: `${fromUnits(plan.qty, market.base.decimals)} ${market.base.symbol}`, limit },
  });
  const ev = parseEventLogs({ abi: challengeAccountAbi, eventName: "OrderSent", logs: sent.receipt.logs }).find((l) => l.address.toLowerCase() === account.toLowerCase());
  return { rule, account, market: market.symbol, side: sideName(side), quantity: fromUnits(plan.qty, market.base.decimals), limit, placedAt: ev ? Number(ev.args.placedAt) : null, transaction: sent.hash };
}

/**
 * Records the account's open order once its auction has run (ChallengeAccount.settle). With `waitMs`, retries while
 * the auction hasn't run yet: Chainlink observes MON about every 30 s, and the auction prices at the first after the seal.
 */
export async function settle(w: Writer, rule: Rule, opts: { waitMs?: number } = {}) {
  const account = await requireAccount(w, rule);
  if (!(await w.client.readContract({ address: account, abi: challengeAccountAbi, functionName: "orderOpen" }))) {
    throw new UnisonError("UNISON_NO_ORDER", "the challenge account has no order in flight", `Send one: mm unison challenge order buy <qty> --rule ${rule}`);
  }
  const data = encodeFunctionData({ abi: challengeAccountAbi, functionName: "settle" });
  const until = Date.now() + (opts.waitMs ?? 0);
  for (;;) {
    try {
      await w.client.estimateGas({ account: w.account, to: account, data });
      break;
    } catch (e) {
      const r = explainRevert(e);
      if (r.name !== "AuctionNotRun" || Date.now() > until) throw new UnisonError(`UNISON_${r.name.toUpperCase()}`, `settle would fail: ${r.text}`, r.hint || "Nothing was sent.");
      await sleep(3_000);
    }
  }
  const sent = await w.send({ to: account, data, summary: "Unison challenge: record the settled order's fill in your challenge account", details: { account, rule } });
  const ev = parseEventLogs({ abi: challengeAccountAbi, eventName: "FillRecorded", logs: sent.receipt.logs }).find((l) => l.address.toLowerCase() === account.toLowerCase());
  const market = await marketOfRule(w.client, rule);
  return {
    rule,
    account,
    filled: Boolean(ev),
    fill: ev
      ? { index: Number(ev.args.index), side: sideName(ev.args.side as Side), base: `${fromUnits(ev.args.base, market.base.decimals)} ${market.base.symbol}`, quote: `${fromUnits(ev.args.quote, market.quote.decimals)} ${market.quote.symbol}` }
      : null,
    transaction: sent.hash,
  };
}

/** An account's standing, judged exactly as a claim would be: every fill marked to Chainlink, by the contract itself. */
export async function score(client: PublicClient, rule: Rule, who: Address) {
  const c = challenges[rule];
  const t = await challengeTerms(client, c);
  const isAccount = (await client.readContract({ address: c, abi: latencyChallengeAbi, functionName: "ownerOf", args: [who] })) !== ZERO;
  const account = isAccount ? who : await accountOf(client, rule, who);
  const potToken = tokens.find((x) => x.address.toLowerCase() === t.pot.toLowerCase());
  const pot = await client.readContract({ address: t.pot, abi: erc20Abi, functionName: "balanceOf", args: [c] });
  const potText = potToken ? `${fromUnits(pot, potToken.decimals)} ${potToken.symbol}` : pot.toString();
  const base = { challenge: c, rule, pot: potText, paid: t.paid, window: { start: new Date(Number(t.start) * 1000).toISOString(), end: new Date(Number(t.end) * 1000).toISOString() }, minFills: Number(t.minFills), thresholdBps: t.epsilonBps };
  if (!account) return { ...base, account: null, note: `no account on the ${rule} challenge for ${who}` };
  const s = await scoreAccount(client, c, account, t);
  const q = markets.find((m) => m.id === Number(t.marketId))!.quote;
  return {
    ...base,
    account,
    owner: await client.readContract({ address: c, abi: latencyChallengeAbi, functionName: "ownerOf", args: [account] }),
    fills: s.fills.length,
    counted: Number(s.counted),
    waitingForMarkout: s.ready ? 0 : s.baseRounds.filter((r, i) => r === 0n && s.fills[i]!.placedAt >= t.start && s.fills[i]!.placedAt <= t.end).length,
    edge: `${fromUnits(s.edge < 0n ? -s.edge : s.edge, q.decimals)} ${q.symbol}${s.edge < 0n ? " lost" : ""}`,
    notional: `${fromUnits(s.notional, q.decimals)} ${q.symbol}`,
    edgeBps: s.edgeBps,
    qualifies: s.qualifies,
  };
}

/** Claims the whole pot, if the account's fills meet the definition (the contract checks, against Chainlink's history). */
export async function claimPot(w: Writer, rule: Rule) {
  const account = await requireAccount(w, rule);
  const c = challenges[rule];
  const s = await scoreAccount(w.client, c, account);
  if (!s.ready) throw new UnisonError("UNISON_MARKOUT_PENDING", "some fills are still waiting for their markout observation", "Chainlink observes MON about every 30 s; try again in a minute.");
  if (!s.qualifies) {
    throw new UnisonError("UNISON_DOES_NOT_QUALIFY", `the account's edge is ${s.edgeBps} bp over ${s.counted} counted fills, which the pot's definition doesn't pay`, "`mm unison challenge score` shows what the definition needs.");
  }
  const sent = await w.send({
    to: c,
    data: encodeFunctionData({ abi: latencyChallengeAbi, functionName: "claim", args: [account, s.baseRounds, s.quoteRounds] }),
    summary: `Unison challenge: claim the ${rule} pot (edge ${s.edgeBps} bp over ${s.counted} fills, checked by the contract against Chainlink)`,
    details: { challenge: c, account, edgeBps: String(s.edgeBps), fills: String(s.counted) },
  });
  return { rule, account, edgeBps: s.edgeBps, counted: Number(s.counted), transaction: sent.hash };
}

/** Withdraws from the challenge account back to its owner (only between orders). */
export async function withdrawFromAccount(w: Writer, rule: Rule, token: Token, amount: string) {
  const account = await requireAccount(w, rule);
  const have = await w.client.readContract({ address: exchange, abi: unisonExchangeAbi, functionName: "balanceOf", args: [account, token.address] });
  const v = amount.trim().toLowerCase() === "all" ? have : toUnits(amount, token.decimals);
  if (v === 0n || v > have) throw new UnisonError("UNISON_NOT_ENOUGH", `the challenge account has ${fromUnits(have, token.decimals)} ${token.symbol}`, "Withdraw less, or `all`.");
  const shown = fromUnits(v, token.decimals);
  const sent = await w.send({
    to: account,
    data: encodeFunctionData({ abi: challengeAccountAbi, functionName: "withdraw", args: [token.address, v] }),
    summary: `Unison challenge: withdraw ${shown} ${token.symbol} from your challenge account to this wallet`,
    details: { account, token: token.symbol, amount: shown },
  });
  return { rule, account, token: token.symbol, amount: shown, transaction: sent.hash };
}
