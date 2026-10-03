# Unison

**The stock market that never closes, and can't be front-run.**

Unison is a venue for tokenized assets on Monad: US equities (Anchored aStocks), FX (Mento GBPm), gold and MON, quoted in AUSD.

- **Every block, one price.** Every 300 ms block is a sealed batch. All of its orders execute at one uniform price, set against a reference price published *after* the batch closed. Arriving first is worth nothing, and stale quotes cannot be sniped.
- **Weekends are priced, not frozen.** When the home market closes, Unison keeps pricing the asset with call auctions inside a band that widens with √time. On Monday it opens with a cross at the real opening print.
- **Liquidity from block one.** An LP vault quotes around the reference every block, and anyone can buy into it.
- **Built for regulated securities.** SEC tokenized-securities-venue conditions (volume caps, tiers, eligibility, halts, public tape) are part of the contracts.

> Track 01 — Onchain Finance & Trading · Monad Metropolis Hackathon

---

## Why it matters

| Today | Unison |
|---|---|
| Tokenized stocks are 59% of permissioned-asset market cap but 0.2% of volume (Pantera, Sep 2026). Liquidity is the bottleneck. | A vault quotes every block, and its LPs are not taxed by latency arbitrage (below). |
| The reference market is open about 32 of the week's 168 hours. NVDA opened more than 2% away from Friday's close on **23%** of Mondays, and MSTR on **53%** (5-year study). | DISCOVERY mode keeps trading inside a √t-widening band. The opening cross clears weekend orders at the open. |
| Continuous venues pay whoever is fastest: snipers drain LPs and widen spreads. | Frequent batch auctions per block: the sniper earned **$0 in 0 fills**, against $487–$6,171/day on the alternatives ([evidence](docs/evidence/fairness.md)). |
| SEC Release 34-106402 (Sep 2026) lets tokenized-securities venues run permissioned AMM pools, under conditions. | The conditions are code: daily ADV caps inside the auction, LULD tier limits, eligibility routing, halt mirroring, and a hash-chained tape. |

## How it works

```
 block b    orders → pending ring (batch b)                 nobody can join an earlier batch
 block b+1  keeper: clearUpTo(b, signedReference(b))        reference published AFTER b closed,
              │  MERGE    batches ≤ b join the books         signature bound to batch b
              │  AUCTION  band = ref ± regime width          LIVE / EXTENDED / DISCOVERY √t / REOPENING
              │           t* = argmax volume                 tie-breaks: min imbalance, closest to ref
              │           vault curve + books, exact pro-rata at the margin
              │  APPLY    level by level, resumable           no call ever does unbounded work
              └  CLOSE_IOC                                   IOC remainders leave the book
 any time   claim / cancel: O(1) lazy settlement             receipts drawn from exact per-level pots
```

**Core ideas**

1. **Batch per Monad block** (Budish–Cramton–Shim frequent batch auctions).
   - One clearing price per batch: maximum volume, then minimum imbalance, then closest to the reference.
   - Pro-rata at the marginal price, apportioned exactly.
   - Per-block batches only make sense on a 300 ms chain with page-priced storage.
2. **Reference published after the close.**
   - Relays sign `Reference(venue, market, batch, price, publishTimeMs, status)`, bound to one batch, with a k-of-n quorum over secp256k1 or P-256 keys.
   - Relays post slashable bonds.
   - A Chainlink CRE workflow audits the reference and can halt the market or slash a relay.
3. **Regimes.**

   | Regime | Behaviour |
   |---|---|
   | LIVE | Normal band |
   | EXTENDED | Wider band |
   | DISCOVERY | Call auctions every N blocks; the band around the last close grows with √(time closed) up to the asset's weekend-gap p99 |
   | REOPENING | Opening-cross band |
   | HALTED | Guardian or CRE override |

4. **Exact, conservative accounting** ([SPEC §3](docs/SPEC.md)).
   - Book state per price level: survival product at 1e38 precision with rescaling, a price accumulator, and pots.
   - Receipts are only ever drawn from pots that hold exactly what was filled, so the venue can never owe more than it holds.
   - Proven by fuzzing, invariants, a 3,000-step simulation and a differential test against an independent TypeScript engine.
5. **Resumable clearing.** A clear is a job (merge → auction → apply → IOC close) that pauses on low gas and resumes. Spam can delay the market but never brick it.
6. **LiquidityVault.**
   - Quotes a curve around the reference, wider when the home market is closed, skewed by inventory, with per-auction loss caps.
   - Deposits and redemptions execute only at a reference published after the request, so no LP can trade the vault against a known Monday gap.
   - A swing fee while closed is paid to the LPs who stay.
   - P&L is attributed on-chain to spread captured versus inventory marked to the reference.
7. **OrderGateway.**
   - EIP-712 signed orders, relayed gaslessly.
   - Session keys with caps on markets, size and notional, which can never withdraw. This is how you hand an AI agent a budget.
   - WebAuthn passkey accounts verified on Monad's P-256 precompile.
8. **TSV compliance.**
   - Daily volume caps are enforced inside the auction. The price is still discovered uncapped; only executed volume is limited.
   - LULD tiers enforce symbol limits.
   - Eligibility is an AND over KYC attestations (Cleanverse) and issuer denylists, mirrored from Anchored's on-chain compliance.
   - Public notices are recorded on-chain.

## What is proven

| Claim | Evidence |
|---|---|
| Correct and solvent | 64 Foundry tests, 1,000-run fuzzing, invariant suite with gas-limited clears, 3,000-step market simulation with strong-solvency checks (`contracts/test`) |
| Two independent implementations agree | Solidity and `@unison/engine` match bit-for-bit on 300 clearings, 200 apportionments and 200 random book histories (`pnpm contracts:diff`) |
| Works with real Monad assets | Mainnet-fork tests on Foundry's Monad EVM: real aNVDA (minted by Anchored's minter), AUSD, WMON and GBPm, plus live Chainlink feeds. Anchored's denylist is mirrored. The full 10-market production deploy was rehearsed on a fork ([test/fork](contracts/test/fork/MonadFork.t.sol)) |
| Cheap on Monad | A 200-order auction is 6.1M gas, about **$0.02**. The same clear is about 40% cheaper under Monad's page pricing than Ethereum's ([gas](docs/evidence/gas.md)) |
| Unsnipeable | Sniper P&L $0 versus $473–$6,171/day on AMM, oracle-AMM and CLOB designs. At equal spread the vault earns 7.7× a CLOB maker ([fairness](docs/evidence/fairness.md)) |
| End to end | Devnet golden path: relay → keeper → vault funding → traders cross → uniform print → auto-claim → AI agent session key → gasless relayed order → filled (`pnpm --filter @unison/keeper e2e`) |

## Repository

```
contracts/   Foundry. core/ (exchange, clearing, book), pricing/ (references), liquidity/ (vault),
             access/ (gateway), compliance/ (eligibility), script/ (DevNet, Deploy)
packages/    engine/ (bit-exact TS clearing + book), sdk/ (viem client, signing, calendar, ABIs)
services/    relay/ (signed references), keeper/ (clear jobs, vaults, auto-claim), relayer/ (gasless orders)
research/    sniper-bench/ (fairness benchmark)
deploy/      network configs (monad-mainnet.json: 11 tokens, 10 markets, every address verified on-chain)
docs/        SPEC.md, evidence/
```

## Quickstart

```bash
pnpm install
pnpm verify                         # contracts build + tests, TS typecheck + tests, Solidity/TS differential fuzz

anvil --code-size-limit 131072 --block-time 1 &                 # Monad allows 128 KB contracts
(cd contracts && forge script script/DevNet.s.sol --rpc-url http://127.0.0.1:8545 --broadcast)
pnpm --filter @unison/keeper e2e    # the golden path, end to end
```

To run against real Monad state:

```bash
anvil --fork-url https://rpc.monad.xyz --port 8546 --code-size-limit 131072 &
cd contracts && forge test --fork-url http://127.0.0.1:8546 --match-contract MonadForkTest -vv
```

## Status

- **Built:** the full engine and every component listed above.
- **Mainnet:** the deploy is rehearsed on a fork and needs the operator keys to go live.
- **Live evidence:** the first weekend DISCOVERY cycle (Fri Oct 9 → Mon Oct 12) will be published in `docs/evidence/`.
- **Equity references:** the dev relay uses Alpaca IEX, or a labelled simulation. Production equities use a licensed feed (Pyth Pro / Chainlink Data Streams adapters).
- **Frontend:** in progress (mobile, Mera passkeys).

## AI disclosure

This project was built with **Claude Code** (Anthropic) as the primary engineering agent, directed by the team. Claude Code wrote the research, the specification, the contracts, the TypeScript services and SDK, the tests and these docs. Every claim above links to code and tests that can be reproduced locally.

## License

MIT
