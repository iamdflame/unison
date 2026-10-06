---
name: unison
description: Trade tokenized stocks and MON on Unison (Monad mainnet) through the MetaMask Agent Wallet CLI, and prove each fill from the chain. Use when someone asks an agent to buy or sell WMON or aNVDA on Monad, to check a Unison auction or receipt, to see Unison markets or balances, or to enter Unison's standing latency challenge. Requires `mm` with the mm-plugin-unison plugin.
---

# Unison through MetaMask Agent Wallet

Unison is a venue on Monad mainnet where orders are **sealed before their price exists**. Every order joins a batch auction that prices at Chainlink's first observation after the order's block, and everyone in that auction trades at one price. No one, including you, can trade against a price they have already seen. Every auction leaves a receipt that anyone can check against Chainlink's own history.

All commands are `mm unison …`. Add `--json` and read the fields named below. Never parse the human text.

## Before trading

1. `mm unison markets --json`: in `markets[]`, pick one whose `state` is `"open"` and whose `rule` starts with `"causal"`. WMON/AUSD trades all week. aNVDA/AUSD follows Nasdaq's session.
2. `mm unison balance --json`:
   - `mon` is the gas;
   - `tokens[].wallet` is what the wallet holds;
   - `tokens[].onUnison` is what orders can use.

   An order trades only from `onUnison`.
3. If `onUnison` is short: `mm unison deposit <amount> AUSD --json`. It approves exactly that amount, never more.
4. `mm unison quote <market> <buy|sell> <qty> --json`:
   - `limit` is the worst price the order accepts;
   - `locks` is what the order holds until its auction runs;
   - `chainlinkReference` is Chainlink's newest price.

   Confirm `locks` is within what the person allowed you to spend.

## Trading

`mm unison order <market> <buy|sell> <qty> [--limit <price> | --slippage <bp>] --json`

- Without `--limit`, the limit sits `--slippage` basis points (default 50) past Chainlink's newest observation. The auction still prices everyone at the next observation. The limit only caps it.
- The command waits for the auction, usually under a minute, settles, and verifies the receipt.
- Read:
  - `status`: `"filled"`, `"not filled"` or `"sealed"` (with `--detach`);
  - `auction.price`: the one price;
  - `fill.bought` / `fill.paid`, or `fill.sold` / `fill.received`, and `fill.fee`;
  - `receipt.verified` and `receipt.receipt`, a link a person can open.
- `"not filled"` is normal: the auction cleared outside the limit, or there was no counterparty. The funds came back whole. Don't retry blindly at a worse limit without the person's consent.

Orders are immediate-or-cancel: one auction each. To get funds back to the wallet, run `mm unison withdraw all AUSD` (or `WMON`).

## Proving a fill

`mm unison receipt <clear tx | receipt link | market upToBlock> --json` re-checks an auction from the chain alone:
- the receipt hash recomputes;
- the price is Chainlink's observation;
- that observation was made after the newest order was sealed, and no earlier one qualified.

`verified: true` means every check passed. Report `receipt` (the link) to the person.

## The standing challenge

A pot pays anyone whose fills, each marked to Chainlink's first observation at least 60 s after the order, show an edge after fees over at least `minFills` fills. One pot runs on Unison's causal market (`--rule causal`), one on a control market kept on the old rule (`--rule old`). The control shows the definition pays where a latency edge exists.

1. `mm unison challenge open [--rule old]`, then `mm unison challenge fund 2 AUSD`.
2. `mm unison challenge order <buy|sell> <qty> --settle --json`: one sealed IOC order; the fill is recorded.
3. `mm unison challenge score --json`: `counted` vs `minFills`, `edgeBps` vs `thresholdBps`, `qualifies`.
4. If `qualifies` is true: `mm unison challenge claim`. The contract checks every markout itself.
5. `mm unison challenge withdraw all AUSD` takes the rest back.

## Errors

Every failure has a `code` and a `hint`. Follow the hint.

| code | what to do |
|---|---|
| `UNISON_NOT_COVERED` | Deposit the amount the hint names, if the person allows it |
| `UNISON_INSUFFICIENTBALANCE` | Same: the venue balance is short |
| `UNISON_MARKET_CLOSED` | Pick another market, or wait for the session |
| `UNISON_AUCTION_LATE` | The order is sealed and will settle. Check `mm unison balance` later, then `mm unison claim` |
| `UNISON_TX_NOT_SENT` | The wallet is waiting for approval (Guard mode). Ask the person to approve it in MetaMask |
| `UNISON_AUCTIONNOTRUN` | Challenge only: settle again in ~30 s |
| `UNISON_DOES_NOT_QUALIFY` | Keep trading, or stop. The score is the contract's own |

## Rules for agents

- Never spend more than the person allowed. `locks` in the quote is the most an order can take.
- Report the auction price and the receipt link for every fill.
- Every transaction carries a one-line intent that the person approving it reads. Don't send anything the person hasn't asked for.
