# Unison

**The stock market that never closes, and can't be front-run.**

Unison is a venue for tokenized assets on Monad: US equities (Anchored aStocks), FX (Mento GBPm), gold and MON, quoted in AUSD.

**Live at https://www.unisonfi.com** · on X: [@unison_fi](https://x.com/unison_fi).
- **Monad mainnet:** a small beta with real assets (Anchored's aNVDA and wrapped MON against AUSD), priced by Chainlink at the first observation made after each auction's orders were sealed. Every contract is verified on Sourcify, and the fills are on-chain ([evidence](docs/evidence/mainnet.md)).
- **Monad testnet:** for practice, with free test funds.
- **The switch:** the venue pill picks the network.

- **The oracle is the clock.** Every 300 ms block seals a batch of orders. On mainnet, the auction for the oldest waiting order prices at **the first Chainlink observation made after it was sealed**, and takes every batch sealed before that observation and nothing later. The contract checks this on chain:
  - it reads the observation time inside the report Chainlink's quorum signed;
  - it proves that observation is the first after the seal;
  - it derives which batches are in.

  So the price didn't exist when anyone in the auction placed their order. Waiting orders can't be cancelled, and the keeper chooses nothing: not the price, not the batch, not the moment ([how, and what it costs](docs/evidence/causal.md)).
- **One price for everyone.** All of an auction's orders execute at one uniform price, so arriving first buys no better price.
- **Snipe us.** A standing challenge pays a pot to anyone whose fills beat Unison's price by more than 2 bp, marked to Chainlink a minute later and judged by a contract. A control market kept on the old rule runs beside it. We replayed our own sniper over a week of real prices:
  - on the old rule it earns +17.8 bp a trade;
  - on Unison it loses 23.0 bp a trade ([evidence](docs/evidence/challenge.md)).
- **Weekends are priced, not frozen.** When the home market closes, Unison keeps pricing the asset with call auctions inside a band that widens with √time. When the home market reopens, its first auction is a reopening cross.
- **Liquidity from block one.** An LP vault quotes around the reference in every auction, and anyone can buy into it. On mainnet it stops quoting while the reference is closed, so nobody trades it against a stale price.
- **Built for regulated securities.** SEC tokenized-securities-venue conditions (volume caps, tiers, eligibility, halts, public tape) are part of the contracts.

> Track 01 — Onchain Finance & Trading · Monad Metropolis Hackathon

## For judges

**Watch first:** [the demo](https://youtu.be/9sgKJ1fDbDY) (2:32, the live product on mainnet: a real sealed trade and its receipt checked from the chain), [the pitch](https://youtu.be/cSYTdJGW_rw) (1:38) and [the ad](https://youtu.be/8zQgZbBkVyQ) (0:21). For the sponsor bounties: [the MetaMask Agent Wallet plugin](https://youtu.be/hFVbVkGmwoI) (1:16), [the Chainlink CRE sentinel](https://youtu.be/ZWlRxmRgO0A) (1:04) and [the Envio HyperIndex scoreboard](https://youtu.be/xIbjZLhRq2A) (0:48).

Steps 1, 2, 4 and 5 need no account, wallet or download. Step 3 needs only a passkey (Face ID, Touch ID or Windows Hello) and the free testnet faucet. Step 6 needs MetaMask's `mm` CLI, and only its order needs a signed-in wallet.

1. **A real mainnet auction, proven.** https://www.unisonfi.com/receipt/mainnet/1/111055816 shows the order sealed, then Chainlink's observation 6 s later, then the clear. From a clone, after `pnpm install`, `node apps/web/scripts/verify-receipt.mjs 0x128b8b18f4ae90cf0f79f439f5886f2f3ff548f2ebb3dcd7a847c2284351596e` checks it from the chain alone.
2. **The live market, on mainnet.** https://www.unisonfi.com/trade/WMON?network=mainnet: the next auction waits for Chainlink's next price, typically 34 s.
3. **Trade it yourself on the testnet.** On https://www.unisonfi.com/trade/aNVDA (the testnet is the default), press **Sign in**, then **Create a passkey**, then **Add test funds**. Tap the **Ask** price and buy 1 aNVDA. The order joins the next auction and fills against the vault within seconds; the fill opens a certificate whose receipt the tape recomputes. No real money is involved.
4. **Snipe us.** https://www.unisonfi.com/challenge: two pots, the contract's definition of an edge, and our own sniper's live score on both rules. Its "Every challenger" table is indexed by Envio HyperIndex ([GraphQL](https://indexer.dev.hyperindex.xyz/c37634b/v1/graphql), [the indexer](services/indexer)) and matches the contract's own score to the unit.
5. **Everything at once.** https://www.unisonfi.com/status lists the services and markets. https://www.unisonfi.com/?demo=1 runs every market in your browser on the real clearing engine, with a paper account.
6. **From an AI agent.** With MetaMask's Agent Wallet CLI and our plugin, [`mm-plugin-unison`](https://www.npmjs.com/package/mm-plugin-unison) on npm (`mm plugins install mm-plugin-unison`; [its source](integrations/agent-wallet-plugin)):
   - `mm unison receipt https://www.unisonfi.com/receipt/mainnet/1/111055816` runs the same six checks;
   - `mm unison challenge score --rule old --address 0xcEc80166Ab48cb3C4ebD98671524761b1fd81276` shows our sniper winning on the old rule;
   - `mm unison order WMON buy 10` trades through the agent's own wallet.

   An agent wallet already did, on 6 October: a sealed sale and a purchase, each priced at Chainlink's observation 7–8 s after its seal, each receipt checked 6 of 6 by the agent ([the run](docs/evidence/agent-wallet.md)).

Trading mainnet itself needs AUSD on Monad and a browser wallet to deposit it. Every mainnet address and transaction is in [docs/evidence/mainnet.md](docs/evidence/mainnet.md).

---

## Why it matters

| Today | Unison |
|---|---|
| Traders want stocks on chain, and mostly get derivatives: in June, stock perpetuals traded 16× the spot volume of tokenized stocks. Of 110 tokenized products worth $10M+, the permissioned ones hold 59% of the value but 0.2% of spot trading (Pantera, Sep 2026). Liquidity is the bottleneck, not issuance. | A vault quotes into every auction, and its LPs are not taxed by latency arbitrage (below). |
| The reference market is open about 32 of the week's 168 hours. NVDA opened more than 2% away from Friday's close on **24%** of Mondays, and MSTR on **53%** (5-year study). | DISCOVERY mode keeps trading inside a √t-widening band. The opening cross clears weekend orders at the open. |
| Continuous venues pay whoever is fastest: snipers drain LPs and widen spreads. Oracle-priced pools leak the same way: a push feed is seconds old when it lands. | Every auction prices after its orders are sealed. On a week of real MON prices, a sniper earns **+17.8 bp a trade on the old rule and loses 23.0 bp on Unison** ([evidence](docs/evidence/challenge.md)). In a market-hours benchmark it earned **$0 in 0 fills**, against $473–$6,171/day on the alternatives ([evidence](docs/evidence/fairness.md)). |
| SEC Release 34-106402 (Sep 2026) lets tokenized-securities venues run permissioned AMM pools, under conditions. | The conditions are code: daily ADV caps inside the auction, LULD tier limits, eligibility routing, halt mirroring, and a hash-chained tape. |

Who trades it first, how it earns, where it stands and the next 90 days: [docs/MARKET.md](docs/MARKET.md). What an outside review found wrong, what it missed, and the order we are fixing things in: [docs/ROADMAP.md](docs/ROADMAP.md).

## How it works

```
 block b      orders → pending ring (batch b), sealed       no cancel; nobody joins an earlier batch
 Chainlink    observation r, signed at startedAt(r)          the first with startedAt(r) > sealedAt(oldest) + 2 s
 r lands      anyone: clear(market, r)                       the contract proves startedAt(r−1) ≤ that bound < startedAt(r)
              │  MERGE    every batch sealed before r         and nothing sealed after it: the keeper chooses nothing
              │  AUCTION  band = price(r) ± regime width     LIVE / EXTENDED / DISCOVERY √t / REOPENING
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
   - Sealing per block, and an auction for every new price, only make sense on a 300 ms chain with page-priced storage.
2. **A reference observed after the seal.** References are adapters:
   - **Mainnet:** `ChainlinkCausalReference` reads Chainlink's rounds by the observation time their quorum signed (`startedAt`), not the time they landed. It proves a round is the first after a given time, and checks the AUSD/USD round in force at it (more than 50 bp off $1 halts). The feeds are the tokenized-equity feed wNVDAx-USD (24/5) for aNVDA and MON/USD for WMON. One WMON market is kept on the old rule as the challenge's control.
   - **Testnet:** relays sign `Reference(venue, market, batch, price, publishTimeMs, status)`, bound to one batch, with a k-of-n quorum over secp256k1 or P-256 keys and slashable bonds.
   - **Chainlink Data Streams (built, not live):** `StreamsCausalReference` applies the same rule to a report signed about once a second. Reports cover back-to-back windows of time, so the report whose window holds the second after the seal is provably the first observation after it. It is tested against Chainlink's real verifier on Monad, with reports Chainlink's DON signed, and the keeper is wired for it. It goes live once a stream is funded, at $150 a month ([evidence](docs/evidence/streams.md)).
   - **Pyth:** an adapter for pull updates is built, but waits: since Pyth's Core upgrade (31 July 2026) every data plan is paid, and US equities cost $5,000 a month.
   - **CRE:** a Chainlink CRE sentinel watches the mainnet feed against Coinbase and Kraken, and halts a market whose feed is both more than 75 bp off and silent for 2 minutes. A second workflow mirrors Nasdaq halts. Both run against Monad mainnet in Chainlink's simulator, as a dry run: they hold no role and halt nothing yet ([logs](docs/evidence/cre.md)). Deploying to a DON waits for CRE access.
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
   - [MetaMask Agent Wallet plugin](integrations/agent-wallet-plugin) (`mm unison …`): an agent trades, verifies receipts and enters the standing challenge from MetaMask's CLI. Its own wallet signs every transaction, under the policy its owner set.
   - WebAuthn passkey accounts verified on Monad's P-256 precompile. One passkey works on every domain the site answers on (related origins, `/.well-known/webauthn`).
8. **TSV compliance.**
   - Daily volume caps are enforced inside the auction. The price is still discovered uncapped; only executed volume is limited.
   - LULD tiers enforce symbol limits.
   - Eligibility is an AND over KYC attestations (Cleanverse) and issuer denylists, mirrored from Anchored's on-chain compliance. The mainnet beta runs the denylist mirror and daily caps, without KYC.
   - Public notices are recorded on-chain.

## What is proven

| Claim | Evidence |
|---|---|
| Correct and solvent | 166 Foundry tests (150, plus 16 on a fork of Monad mainnet at the current block), 1,000-run fuzzing, invariant suites with gas-limited clears and causal clears, 3,000-step market simulation with strong-solvency checks (`contracts/test`) |
| Priced after the seal | 22 unit tests of the causal rule: not the first round, a sealed order left out, a later one slipped in, a cancel while sealed, time running backwards, an AUSD depeg. Before the 6 October cutover, fork tests upgraded the live mainnet exchange in place and cleared WMON and aNVDA on real Chainlink rounds. `node apps/web/scripts/verify-receipt.mjs <tx>` checks any auction against Chainlink's history from the chain alone |
| Snipers win on the old rule and lose on Unison | The house bot replayed over 7 days of Coinbase trades and Chainlink rounds (+17.8 bp a trade on the old rule, −23.0 bp on Unison, never above −15.8 bp over 30 fills). On mainnet the same bot trades both markets live, and a contract pays whoever beats the definition ([challenge](docs/evidence/challenge.md), `/challenge`) |
| The clearing's rules, proven | Halmos checks every input of two book shapes, by symbolic execution. On a 2-tick band with any `uint64` quantity, it proves the price stays inside the band, never overfills, respects the cap and maximizes volume. On a 3-tick band with quantities below 2^16, it proves the maximum-volume price and exact marginal fills. The other two runs found no counterexample but did not finish ([proofs](docs/evidence/proofs.md)) |
| Static analysis, triaged | Slither and Aderyn run on every change, and every finding has a written verdict. One is real: a redemption a token refuses (a frozen address) stops a vault's queue. Vault v2 fixes it, built and tested; the live vaults are v1 and immutable, so v2 ships as new vaults before any outside LP deposits ([static analysis](docs/evidence/static-analysis.md)) |
| Two independent implementations agree | Solidity and `@unison/engine` match bit-for-bit on 300 clearings, 200 apportionments and 200 random book histories (`pnpm contracts:diff`) |
| Works with real Monad assets | Mainnet-fork tests on Foundry's Monad EVM: real aNVDA (minted by Anchored's minter), AUSD, WMON and GBPm, plus live Chainlink feeds. Anchored's denylist is mirrored. The full 10-market production deploy was rehearsed on a fork ([test/fork](contracts/test/fork/MonadFork.t.sol)). The mainnet beta was rehearsed end to end on a fork: the real deploy script, vault seeding, a passkey account funded from a browser wallet, a 0.01-share aNVDA buy filled by the vault, and its certificate ([`deployments/monad-fork-beta.json`](deployments/monad-fork-beta.json), `apps/web/scripts/flow-mainnet.mjs`) |
| Cheap on Monad | A 200-order auction is 6.1M gas, about **$0.02**. The same clear is about 40% cheaper under Monad's page pricing than Ethereum's ([gas](docs/evidence/gas.md)) |
| Unsnipeable (benchmark) | In a simulated benchmark, sniper P&L is $0 versus $473–$6,171/day on AMM, oracle-AMM and CLOB designs, and at equal spread the vault earns 7.7× a CLOB maker. Re-run with the rule as deployed: on a modelled push clock the sniper loses $216 a day and orders wait 40 s at the median (longer on the real feed); on a 1-second pull clock it makes $0 and the median wait is 3.6 s ([fairness](docs/evidence/fairness.md)). On mainnet the standing challenge measures it in the open |
| End to end | Devnet golden path: relay → keeper → vault funding → traders cross → uniform print → auto-claim → AI agent session key → gasless relayed order → filled (`pnpm --filter @unison/keeper e2e`) |
| Live on Monad mainnet | The causal cutover on 6 October 2026: the first causal print passes every check of `verify-receipt.mjs` (observed 6 s after the seal), and the same sale on the old-rule control paid the sniper 40 bp more. Exchange v3 followed on 10 October, rehearsed on a mainnet fork first: stopping a market returns every waiting order, and the gateway role is locked. Every print is on the receipt chain; every contract is verified on Sourcify; outside traders are counted apart from the team (`GET /v1/stats`) ([mainnet evidence](docs/evidence/mainnet.md)) |

## Why Monad

Unison's design depends on Monad's specific properties. The full table, with the evidence for each row, is in [docs/MONAD.md](docs/MONAD.md).
- **300 ms blocks:** every block seals a batch, so an order's seal sits close to the Chainlink observation that prices it.
- **Page-priced storage (MIP-8):** the book is laid out page by page, so a clear costs 1.77M gas under Monad's rules against 3.01M under Ethereum's. An auction for every new price stays affordable.
- **Parallel execution:** no shared hot slot on the order path.
- **P-256 precompile:** passkey accounts are verified on chain.
- **128 KB contracts:** the exchange is one contract, with no proxy hops in the clearing loop.
- **Real assets already on chain:** Anchored's aStocks, Agora's AUSD and Chainlink's feeds.

## Repository

```
contracts/   Foundry. core/ (exchange, clearing, book), pricing/ (references, the causal adapter), liquidity/ (vault),
             access/ (gateway), compliance/ (eligibility), challenge/ (the standing challenge),
             script/ (DevNet, Deploy, UpgradeCausal, UpgradePhaseA, DeployChallenge, HandoverTimelock)
packages/    engine/ (bit-exact TS clearing + book), sdk/ (viem client, signing, calendar, ABIs)
services/    relay/ (signed references), keeper/ (clear jobs, vaults, auto-claim), relayer/ (gasless orders),
             tape/ (indexer: prints, orders, receipts, live stream), mcp/ (tools for AI agents),
             adversary/ (our own sniper in the standing challenge, and its backtest),
             indexer/ (Envio HyperIndex: every challenger's score, marked to Chainlink as the contract marks it)
integrations/ agent-wallet-plugin/ (MetaMask Agent Wallet: mm unison markets, order, receipt, challenge)
apps/web/    the website and the trading app (Next.js); design system in apps/web/DESIGN.md;
             scripts/ops/ funds and launches mainnet (keys from .secrets, never printed)
bots/        house order flow for devnets and the testnet (never mainnet)
research/    sniper-bench/ (fairness benchmark)
deploy/      network configs: monad-mainnet-beta.json (the live beta), monad-mainnet.json (the full 10-market
             deploy, every address verified on-chain), fork rehearsals
deployments/ what was deployed: monad-mainnet.json, monad-testnet.json, fork rehearsals
docs/        SPEC, ARCHITECTURE, API, AGENTS, MONAD, MARKET, ROADMAP, GO_LIVE, DEPLOY, THREAT_MODEL, TSV_COMPLIANCE, evidence/
cre/         Chainlink CRE workflows (cre/unison): the feed sentinel, Nasdaq halts, ADV caps, reference audits
video/       the demo, pitch, ad and bounty films (Remotion): scripts, scenes, capture and mastering tools;
             footage, voice and music stay local (YOUTUBE.md lists the uploads)
ops/         the services' Dockerfiles (Railway, Fly)
scripts/     the local dev stack, and the Solidity/TypeScript differential runner
```

## Tech stack

| Layer | What |
|---|---|
| Contracts | Solidity 0.8.33 (via-IR, Prague), Foundry, OpenZeppelin Contracts (upgradeable) |
| Prices | Chainlink price feeds (OCR2, read by their signed observation time), Chainlink CRE workflows |
| SDK and engine | TypeScript, viem; `@unison/engine` is a bit-exact TypeScript port of the clearing |
| Services | Node 24, Hono, `node:sqlite` (tape), Envio HyperIndex (the challenge's indexer) |
| Agents | MCP server; MetaMask Agent Wallet plugin (`mm unison`), signing through the agent's own wallet |
| Web | Next.js 16, React 19, Tailwind CSS, Base UI, Motion, three.js, NumberFlow |
| Accounts | WebAuthn passkeys verified on Monad's P-256 precompile; EIP-712 orders relayed gaslessly |
| Hosting | Vercel (web), Railway (keeper, tape, relayer, relay, adversary), Envio Cloud (the indexer) |
| Video | Remotion (React); narration, music and effects generated with ElevenLabs |

## Quickstart

Requirements: Node 24 or later, pnpm 12, Foundry (forge 1.8 or later) and git.

```bash
git clone https://github.com/iamdflame/unison && cd unison
git submodule update --init --recursive   # forge-std and OpenZeppelin
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

## Website and app

`apps/web` is the site and the trading app in one Next.js project:

- **The site:** home, fairness, developers, status, brand and legal pages.
- **The app:** trade, markets, portfolio, vaults, and agent keys.

Accounts are passkeys (Face ID, Touch ID, Windows Hello), orders are gasless, and each fill comes with a certificate whose receipt the tape recomputes.

- **Two networks, one site.** The venue pill switches between Monad testnet (practice) and Monad mainnet (real assets); `?network=mainnet` links stick.
- **Mainnet shows only what it lists**, never a simulation beside real assets.
- **Funding.** On mainnet you deposit from a browser wallet (approve, then `depositFor` your passkey account). On the testnet a faucet adds test funds.
- **Prices you can act on.** The ticket opens at the price that fills now. On Chainlink markets the page reads the live reference from the chain, so what it shows is what the next auction uses.
- **No venue running:** the app runs every market in the browser on the real clearing engine, and labels itself as a simulation.

A first visit to the terminal is offered a guided tour: the page dims, one part stays lit, and a card says what it is, from the auction strip and the batch chart to the ticket, the account and the certificates. It replays from ⌘K ("Take the tour") or from the terminal's "About" panel.

```bash
pnpm --filter @unison/web dev     # http://localhost:3000; with no venue running it simulates (or add ?demo=1)

# a live local venue (chain, relay, keeper, relayer, tape), with the web app pointed at it:
WEB_ENV_OUT=apps/web/.env.local node scripts/dev-stack.mjs
pnpm --filter @unison/web dev
```

Quality gates, run from `apps/web`:

| Gate | Command |
|---|---|
| Unit tests (contrast, facts, receipts, clearing window) | `pnpm test` |
| Typecheck and lint | `pnpm typecheck`, `pnpm lint` |
| JS budgets: 180 KB marketing, 250 KB app (first load, gzip) | `pnpm build && node scripts/weigh.mjs --check` |
| Accessibility: WCAG 2.2 AA on every route, both lights | `pnpm a11y` |
| Live flows on the devnet: passkey → buy → certificate; withdrawal; agent keys through MCP; the shell's controls | `node scripts/flow-live.mjs` (and `flow-portfolio`, `flow-agents`, `flow-shell`) |
| The guided tour, desktop and phone: every stop lit, keys, replay, remembered | `node scripts/flow-tour.mjs` (`LIVE=1` against a live venue) |
| Mainnet, read-only: the switch, real markets only, the price source named; with `REHEARSAL=1` on a local fork, passkey → wallet deposit → 0.01-share buy → certificate | `node scripts/flow-mainnet.mjs` |
| One passkey across the site's domains (related origins), against the deployed site | `node scripts/flow-passkey-domains.mjs` |

## Status

- **Built:** the full engine and every component listed above.
- **Mainnet beta, live since 5 October 2026.** Exchange `0x1696170d40E703F1378989383c21Ec96ED1Adf75` on chain 143. Since 6 October, aNVDA/AUSD and WMON/AUSD price every auction at the first Chainlink observation made after its orders were sealed ([`deploy/monad-mainnet-causal.json`](deploy/monad-mainnet-causal.json)).
  - WMON/AUSD (old rule) is the standing challenge's control.
  - No Unison key signs a mainnet price.
  - The vaults are small, each market has a daily cap, and Anchored's denylist is mirrored.
  - Every address, transaction and first print is in [docs/evidence/mainnet.md](docs/evidence/mainnet.md) ([runbook](docs/GO_LIVE.md)).
- **Admin:** exchange v3 has been live since 10 October 2026 ([record](docs/evidence/mainnet.md#phase-a-exchange-v3-10-october-2026)).
  - Pausing, halting or deactivating a market returns every waiting order at once.
  - The gateway role is locked: no key can grant it without an upgrade.
  - The deployer key still holds the other admin roles, upgrades included. The [threat model](docs/THREAT_MODEL.md#what-the-admin-can-do) lists each power.
  - Next is a 7-day timelock from the first day, proposed by a Safe with outside signers. It was promised "before judging"; it waits on the signers, and this line will say when it's done ([roadmap](docs/ROADMAP.md)).
- **Live evidence:** the first weekend DISCOVERY cycle (aNVDA closed from Fri 9 October 20:00 ET, reopening on Chainlink's first observation after Sun 11 October 20:00 ET) will be published in `docs/evidence/`.
- **Equity references:** on testnet the relay signs prices from market data (Yahoo Finance's public quotes; Alpaca IEX with a key, or a labelled simulation). On mainnet they are Chainlink's tokenized-equity feeds. (A second-by-second clock is built on Chainlink Data Streams and waits for a funded stream; Pyth's data has been paid-only since 31 July 2026 ([evidence](docs/evidence/streams.md)).)
- **Other venues on Monad:** Monday Trade has offered permissionless 24/5 trading of Anchored aStocks since April 2026, continuously, spot and perpetuals. Unison's difference is the auction: one price per auction, at a Chainlink observation made after its orders were sealed, liquidity that isn't picked off, and price discovery through the weekend.
- **Public testnet: live.** https://www.unisonfi.com, on Monad testnet (chain 10143), lists aNVDA, aSPY and aQQQ; the other markets run as a labelled browser simulation. Passkey accounts, a faucet, gasless orders and certificates work end to end. Addresses: `deployments/monad-testnet.json`.
- **Hosting.** The web app runs on Vercel. The services run on Railway: relay, keeper, relayer and tape for the testnet, and keeper, relayer, tape and the house adversary for mainnet, which needs no relay ([DEPLOY](docs/DEPLOY.md)).
- **Frontend:** reviewed over ten rounds by fresh-context AI review panels with design, luxury and trading personas.

## Acknowledgements and pre-existing code

- **Built during the hackathon.** Everything in this repository was written for it; the first commit is dated 3 October 2026.
- **Derived code:** [`contracts/src/libraries/WebAuthn.sol`](contracts/src/libraries/WebAuthn.sol) follows Daimo's and Coinbase Smart Wallet's WebAuthnSol (MIT), as its header says.
- **Libraries:**
  - Contracts: [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) and their upgradeable variant (MIT), [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0), [Foundry](https://github.com/foundry-rs/foundry).
  - TypeScript: [viem](https://viem.sh) (MIT), [@noble/curves and @noble/hashes](https://github.com/paulmillr/noble-curves) (MIT), [Hono](https://hono.dev) (MIT), [zod](https://zod.dev) (MIT), the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) (MIT), the [Chainlink CRE SDK](https://docs.chain.link/cre), [Envio HyperIndex](https://docs.envio.dev), [oclif](https://oclif.io) (MIT) and [esbuild](https://esbuild.github.io) (MIT). The MetaMask Agent Wallet plugin builds against [`@metamask/agent-wallet`](https://docs.metamask.io/agent-wallet/plugins/), which the host CLI provides at run time; the plugin's layout follows MetaMask's plugin template.
  - Web: [Next.js](https://nextjs.org) and [React](https://react.dev) (MIT), [Base UI](https://base-ui.com) (MIT), [three.js](https://threejs.org) and react-three-fiber (MIT), [NumberFlow](https://number-flow.barvian.me) (MIT), [lucide](https://lucide.dev) (ISC), [cmdk](https://cmdk.paco.me) (MIT), [Shiki](https://shiki.style) (MIT), [Sonner](https://sonner.emilkowal.ski) (MIT), Tailwind CSS (MIT).
  - Fonts: Bodoni Moda, Mona Sans and Fragment Mono, under the SIL Open Font License 1.1 (`apps/web/assets/fonts/LICENSE.md`).
- **Data and services:**
  - Chainlink price feeds on Monad;
  - Coinbase and Kraken public market data (the backtest and the house adversary);
  - Anchored's aStocks and Agora's AUSD, as listed assets.

## AI disclosure

This project was built with **Claude Code** (Anthropic) as the primary engineering agent, directed by the team.
- **What Claude Code wrote:** the research, the specification, the contracts, the TypeScript services and SDK, the web app and its brand system, the tests and these docs.
- **AI review:** design and claims were reviewed by fresh-context AI panels.
- **The videos:** Claude Code wrote the scripts and built every film in Remotion, from captures of the live site and the programs' own output. The narration is generated with ElevenLabs (Eleven v4), as are the music and sound effects.
- **What the team did:** directed the work, made the decisions, tested on real devices, funded and operated mainnet, and signed every mainnet transaction from its own keys.

Every claim above links to code and tests that can be reproduced locally.

## License

[MIT](LICENSE)
