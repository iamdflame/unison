# mm-plugin-unison

**Unison for MetaMask Agent Wallet.** Your agent trades WMON and tokenized stocks on Monad mainnet in sealed batch auctions. Each order's price doesn't exist when it is sent: the auction prices it at Chainlink's first observation after the order's block, at one price for everyone in the auction. Then the agent checks its own receipt from the chain.

Run in MetaMask's `mm` 7.0.0 against Monad mainnet on 6 October 2026:

```
$ mm unison receipt https://www.unisonfi.com/receipt/mainnet/1/111055816
PASS  receipt hash recomputes: 0x803dea559b45aa0679696bb2d4e1bab50bf904719bbb2b9530781d5a4f5de65e
PASS  the receipt's reference time is Chainlink's observation time (1791295082)
PASS  observed strictly before the report landed on chain (a signed observation, not a block time)
PASS  the newest order was sealed in block 111055816, at 1791295076
PASS  observed 6 s after the seal (more than the 2 s skew)
PASS  the round before it was observed at 1791295052, not after the seal: no earlier observation qualified

Verified: 6 of 6 checks pass. https://www.unisonfi.com/receipt/mainnet/1/111055816

$ mm unison challenge score --address 0xcEc80166Ab48cb3C4ebD98671524761b1fd81276
8 of 30 counted fills, edge -21.2 bp (0.001469 AUSD lost); the pot pays above 2 bp. Not yet. Pot: 18 AUSD.

$ mm unison challenge score --rule old --address 0xcEc80166Ab48cb3C4ebD98671524761b1fd81276
8 of 30 counted fills, edge 12.29 bp (0.000853 AUSD); the pot pays above 2 bp. Not yet. Pot: 1 AUSD.
```

The second and third commands are the same house sniper running the same strategy on both pots. It loses on Unison's rule and wins on the old one.

## Why an agent wants this

An agent that trades on a venue priced by an oracle can be sniped. A faster bot sees the next price before it lands on chain and trades against the agent's stale quote. It can also snipe others, and then a person has to trust it didn't. On Unison neither can happen: the order is sealed before its price exists, and the receipt proves it.

- **Fair by construction.** Every order in an auction gets the same price: Chainlink's first observation after the newest order was sealed. Being first buys nothing.
- **Verified, not trusted.** `mm unison receipt` re-derives the price from Chainlink's own history and recomputes the receipt hash, from the chain alone. `mm unison order` does it for every fill.
- **A standing challenge for agents.** An on-chain pot pays any account whose fills beat Chainlink's next observation over enough trades. The contract checks every markout. `mm unison challenge …` enters it, on Unison's market or on a control market kept on the old rule.

## Commands

| Command | What it does | Capabilities |
|---|---|---|
| `unison markets` | Each market's state, Chainlink's newest observation, the last auction's price | none |
| `unison quote <market> <side> <qty>` | The limit, what the order locks, the fee; before signing anything | none |
| `unison receipt <tx \| link \| market upTo>` | Checks an auction from the chain: the receipt hash, and the price's place in Chainlink's history | none |
| `unison balance` | Wallet and Unison balances, MON for gas, open order slots | `wallet-read` |
| `unison deposit <amount> [token]` | Approves exactly that amount, then deposits it to the Unison balance | `wallet-read`, `wallet-submit` |
| `unison order <market> <side> <qty>` | Seals an order, waits for its auction, settles it, verifies the receipt | `wallet-read`, `wallet-submit` |
| `unison claim` | Claims settled orders the keeper hasn't | `wallet-read`, `wallet-submit` |
| `unison withdraw <amount\|all> [token]` | Back to the wallet | `wallet-read`, `wallet-submit` |
| `unison challenge open\|fund\|order\|settle\|score\|claim\|withdraw` | Enter the standing challenge, trade through the challenge account, check the score, claim the pot | `wallet-read` (score), `wallet-submit` (the rest) |

Every command takes `--json`. [`skills/unison/SKILL.md`](skills/unison/SKILL.md) teaches an agent the golden path, the fields to read and what each error code means.

## How it uses Agent Wallet

- **The plugin never touches a key.** Every write is one `ctx.walletExecutor(io, commandId)` request:
  - `kind: "transaction"`, `chainId: 143`;
  - calldata built from Unison's ABIs;
  - a gas limit from `estimateGas` plus 12%, since Monad charges the limit;
  - an intent a person approving it can read, e.g. *"Unison: sealed buy of 10 WMON at ≤ 0.0288 AUSD, priced at Chainlink's next observation"*.

  Guard mode asks the person; Beast mode signs within its policy.
- **Writes stop before signing anything that would fail.** A call that would revert is decoded against Unison's errors and stopped with a hint, e.g. *"Deposit at least 0.29 AUSD first: mm unison deposit 0.29 AUSD"*.
- **Reads go through `ctx.publicClient(143)`** in commands that write. Read-only commands use Monad's public RPC and need no sign-in.
- **Capabilities are per command.** `markets`, `quote` and `receipt` declare none. Writes declare `wallet-submit` only where they send.
- **Approvals are exact.** Deposits approve the amount deposited, never an unlimited allowance.
- **One self-contained bundle.** The Unison SDK, viem and the mainnet deployment record are bundled into readable, unminified `dist/`, so the plugin installs with no dependencies. The host's `@metamask/agent-wallet/plugin` stays external, as the host requires.

## Install

From npm (once published):

```
mm config set experimentalPlugins true
mm plugins install mm-plugin-unison
```

From this repository:

```
pnpm install
pnpm --filter mm-plugin-unison stage     # builds, writes oclif.manifest.json, and stages the package outside the repo
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:<the staged path it prints>" --accept-permissions
```

The plugin is staged outside the repository on purpose. Installed in place, Node would resolve the plugin's host import from this package's own `node_modules`, a second copy of the CLI that the host warns breaks plugins. `minCliVersion` is `>=6.2.0`: the host checks it with `semver.satisfies`, and the template's `^6.2.0` would refuse today's `mm` 7.

## The contracts it calls (Monad mainnet, chain 143)

| Contract | Address |
|---|---|
| UnisonExchange | `0x1696170d40E703F1378989383c21Ec96ED1Adf75` |
| ChainlinkCausalReference | `0xB161400dDfC592fD66b57dDaE46966ED74Ce891d` |
| LatencyChallenge (causal) | `0xDcD3E86518db6A40C4feBa576efff598cA3B90d1` |
| LatencyChallenge (old-rule control) | `0x5Ce9D9f491E2d16c94F56eD09BEa23e7109976e9` |

All are verified on Sourcify. The plugin reads them from [`deployments/monad-mainnet.json`](../../deployments/monad-mainnet.json) at build time.

## Tests

```
pnpm --filter mm-plugin-unison test
```

The unit tests cover:
- order planning: limits rounded toward the trader, the exchange's exact buy-lock arithmetic, refusals;
- selecting the agent's wallet from the host's state;
- decoding reverts into hints;
- receipt lookups.

[`test/fork.test.ts`](test/fork.test.ts) runs the write paths through the same `Writer` interface against an anvil fork of Monad mainnet, when `FORK=1`.
