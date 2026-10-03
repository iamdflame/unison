# Architecture

Unison has three layers:

1. **On-chain:** a venue (exchange + books + clearing), its price references, liquidity sources, access paths and compliance.
2. **Off-chain operator services:** these keep the venue fed (reference relay), cleared (keeper) and accessible (relayer).
3. **Client layer:** the SDK and the bit-exact engine, used by apps and agents.

```
                 ┌────────────────────────────── Monad (chain 143) ───────────────────────────────┐
  traders ──────►│ UnisonExchange (UUPS proxy, 36.6 KB, one contract — Monad allows 128 KB)        │
  agents  ──────►│  ├─ ExchangeBase       ledger (page-per-account), order slots, roles, events    │
  passkeys ─┐    │  ├─ ExchangeClearing   resumable clear job: MERGE → AUCTION → APPLY → CLOSE_IOC   │
            │    │  ├─ BookStore          levels: remaining · S (1e38) · A · pots · close-in-place   │
            │    │  └─ Clearing           uniform-price FBA (pure)                                   │
            │    │                                                                                  │
            └───►│ OrderGateway ── EIP-712 orders / session keys (agents) / WebAuthn passkeys       │
                 │ References: OperatorSignedReference · ChainlinkReference · PythReference         │
                 │ Liquidity:  LiquidityVault (ICurveSource) — merged into every auction            │
                 │ Compliance: EligibilityRouter → AttestationEligibility (KYC) ∧                   │
                 │             IssuerDenylistEligibility (mirrors e.g. Anchored's denylist)         │
                 └──────▲───────────────────▲───────────────────────▲───────────────────────────────┘
                        │ signed reports    │ clearUpTo / process  │ placeBatch
                  ┌─────┴─────┐       ┌─────┴─────┐          ┌─────┴─────┐
                  │  relay    │◄──────│  keeper   │          │  relayer  │◄── signed orders (HTTP)
                  │ (prices,  │ report│ (per block│          │ (gasless) │
                  │ calendar) │       │ policy)   │          └───────────┘
                  └───────────┘       └───────────┘
                        ▲ Alpaca IEX / licensed feed        CRE workflows audit references, mirror halts,
                                                            write daily ADV caps (CAP_ROLE / HALT_ROLE)
```

## Contracts

| Contract | Responsibility | Key properties |
|---|---|---|
| `UnisonExchange` | Entrypoints: deposits and withdrawals, orders, cancels, claims, `clear` / `clearUpTo`, admin, views | UUPS. Roles: `DEFAULT_ADMIN`, `OPERATOR`, `GUARDIAN` (pause), `HALT_ROLE`, `GATEWAY_ROLE`, `CAP_ROLE`. ReentrancyGuardTransient. |
| `ExchangeBase` | ERC-7201 storage, ledger primitives, order-slot codec | One 128-slot page per account: 16 balances, a bitmap and 55 orders |
| `ExchangeClearing` | The clear job | Every phase pauses below 300k gas and resumes in the next call. A self-check reverts unless bid fills = ask fills = volume. |
| `BookStore` | Price levels with exact lazy pro-rata | Survival product at 1e38 precision with 1e9 rescales; per-scale accumulator; pots; full fills close in place; archived on reuse; 3-level occupancy hierarchy |
| `Clearing` | Uniform-price auction (pure) | Max volume, then min imbalance, then closest to the reference, then lowest tick; exact marginal fill; optional regulatory volume cap |
| `OrderMath` | Locks, fees, exact cumulative apportionment | Buy locks provably cover quote and fee (+4 units of slack) |
| `OperatorSignedReference` | Equity references | EIP-712 bound to venue, market and batch; k-of-n secp256k1 or P-256 quorum; freshness; monotonic; bonded signers with a 7-day unbond and `SLASHER_ROLE` |
| `ChainlinkReference` | FX, metals, crypto | base/USD ÷ quote/USD; OPEN only in-session and while fresh, otherwise CLOSED (DISCOVERY) |
| `PythReference` | Pull oracle | Pays update fees; returns the publish time, so the after-close rule applies; confidence gate |
| `LiquidityVault` | Always-on liquidity | Curve around the reference (regime multiplier, inventory skew, per-auction cap); ERC-7540-style async flows at post-request references; swing fee; P&L attribution |
| `OrderGateway` | Relayed signed actions | Account (ECDSA / ERC-1271), session keys (capped, no withdraw), WebAuthn passkeys; unordered nonces |
| `AttestationEligibility` · `IssuerDenylistEligibility` · `EligibilityRouter` | Who may move restricted value | Stores the KYC outcome only; issuer denylists mirrored; AND of all sources |

## One block in the life of the venue

1. **Block b.** Orders arrive.
   - A buy locks its notional at the limit, plus the maximum fee, plus slack. A sell locks base.
   - Orders aggregate into the pending ring under `(batch b, side, shard, ioc, tick)`. Steady-state slot reuse means no state growth.
2. **Block b+1.**
   1. The keeper asks the relay for `Reference(venue, market, b, price, publishTimeMs, status)`, published after b closed.
   2. It simulates `clearUpTo(market, b, payload)` with `eth_call`, and sends it only if the clear trades, stale pending orders need merging, or a vault queue needs a fresh reference.
3. **Inside `clearUpTo`.**
   1. **Open.** Bind the reference: signature, freshness, published after the newest batch ≤ b. Apply the halt override and the DISCOVERY cadence.
   2. **MERGE.** Each pending group joins its book level once and stores a two-word merge snapshot shared by all its orders.
   3. **AUCTION.** Compute the band (regime). Build the input from the books (bucket-skipping scans) plus capped, band-clipped vault curves. Run `Clearing.compute` with the remaining daily cap. Settle curve sources atomically.
   4. **APPLY.** Visit, by side, the stages OUTSIDE → INBAND → MARGINAL, then each book, then each tick. Full fills close levels in place. The marginal class is split by exact cumulative apportionment, with sources first and books continuing.
   5. **CLOSE_IOC.** Force-close IOC levels. Asks keep a return pot.
   6. **Finalize.** Write the receipt hash chain, emit `BatchCleared` (the tape), update the cap and regime state, and pay the keeper reward.
4. **Any time.** `claim` or `cancel` values an order from its group snapshot in O(1):
   - remainder rounded up;
   - quote rounded up for bids, down for asks.

   Receipts come out of the level's pots. Cancels remove `min(⌈lazy⌉, real)`.

## Off-chain services

| Service | Does | Trust |
|---|---|---|
| `services/relay` | Signs batch-bound references from licensed data plus the NYSE calendar. Freezes the reference at the last open print while CLOSED. Monotonic. Refuses future or stale batches. | Bonded, quorum-able and audited by CRE. A bad report can move prices only within the band, and it is slashable. |
| `services/keeper` | Drives clear jobs per block (cost-aware), processes vault queues, auto-claims fills | Permissionless: anyone can clear. The keeper has no privileges. |
| `services/relayer` | Accepts signed orders, validates them with `eth_call`, batches `placeBatch` | Cannot forge or alter orders. Can delay them, bounded by the deadline, and users can always submit directly. |
| `packages/engine` | Bit-exact TypeScript clearing and book | Differentially fuzzed against the contracts |
| `packages/sdk` | Typed client, signing (references, gateway, passkeys), calendar, ABIs | — |

## Upgrade and control

- The exchange is a UUPS proxy. Upgrades require `DEFAULT_ADMIN` (a multisig behind a timelock in production).
- The guardian can only pause or halt.
- Core math (`Clearing`, `BookStore`, `OrderMath`) is library code with no admin surface.
- Every parameter change emits an event: `MarketParamsSet`, `RegimeSet`, `DailyCapSet`, `TierSet`, `SourceSet`, `HaltSet`.
