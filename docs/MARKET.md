# The market: who Unison is for, and how it earns

Traders want stocks on chain, and mostly get them as derivatives: in June, stock perpetuals traded 16 times the spot volume of the tokenized stocks themselves. The spot venues pay whoever sees the next price first, so market makers widen their quotes or leave. Unison is a venue where nobody can see the next price first. Every auction prices at the first Chainlink observation made after its orders are sealed. Liquidity providers can then quote tight around the clock, weekends included, without being picked off.

## The problem, measured

- **Liquidity, not issuance.** Pantera's *State of Tokenization* (29 September 2026) counts $332B across 671 tokenized assets ([report](https://panteracapital.com/state-of-tokenization/); [a summary](https://www.techflowpost.com/en-US/article/34333)).
  - Of the 110 non-stablecoin products worth $10M or more, the permissioned ones are 59% of the value but 0.2% of spot volume, and 46 of the 48 allowlisted products turn over less than 1% a month.
  - The demand is there. Tokenized stocks were the most actively traded category in June (204.6% spot turnover), and stock perpetuals on Hyperliquid and Lighter traded $67.8B that month, 16 times tokenized stocks' spot volume.
  - Pantera's conclusion: issuing tokens is no longer the hard part; compliant, liquid secondary markets are.
- **Growing anyway.** Tokenized stocks reached a record $3.8B market cap on 6 October 2026. About 4.1 million addresses hold them, up more than 60% in 30 days ([Crypto Briefing](https://cryptobriefing.com/tokenized-stocks-record-market-cap/), citing RWA.xyz, Token Terminal and Binance Research). BNB Chain, Ethereum and Solana hold most of it.
- **Why the venues leak.** A Chainlink observation lands on chain about 13 s after it is made, and anyone watching the market sees the move first. On MON/USD, 6.1% of observations moved more than the WMON vault's 23 bp of spread and fee: 5.3 chances an hour to trade against a price that was already old ([causal evidence](evidence/causal.md)).
  - In a market-hours benchmark, snipers took $473 to $6,171 a day from AMM, oracle-AMM and CLOB designs.
  - At the same ±2 bp quote, a CLOB maker kept $84 a day after snipers took $487. Unison's vault kept $646 and lost nothing ([fairness evidence](evidence/fairness.md)).
- **Weekends are where it's worst.** Nasdaq trades 32.5 of the week's 168 hours. Over five years, NVDA opened more than 2% away from Friday's close on 24% of weekends, and MSTR on 53% ([weekend-gap study](evidence/weekend-gaps.md)). A venue that is open while its reference is shut must discover the price, not copy it.

## Why now

- **The assets are on Monad:**
  - Anchored's aStocks;
  - Agora's AUSD (about $184M on Monad, 69% of all AUSD);
  - Chainlink's tokenized-equity feed for NVDA (wNVDAx-USD, 24/5), and MON/USD.

  Unison trades all of them on mainnet today.
- **The chain makes batches cheap.** With about 300 ms blocks and page-priced storage, Unison runs one sealed batch per block. Clearing a 200-order batch costs about $0.02, and 41% less gas than the same code under Ethereum's rules ([gas evidence](evidence/gas.md)).
- **The rules arrived.** SEC Release 34-106402 (17 September 2026) lets Tokenized Securities Venues trade tokenized stocks under conditions: symbol limits by tier, volume caps, halt coordination, public trade data. Unison implements each condition as code ([TSV map](TSV_COMPLIANCE.md); an engineering map, not legal advice).
- **Agents trade now.** MetaMask shipped Agent Wallet with plugins in August 2026. Unison's plugin lets an agent trade, prove its fills from the chain, and enter the standing challenge ([plugin](../integrations/agent-wallet-plugin)).

## Who uses it first

1. **People holding tokenized stocks outside US hours.** About 4.1 million addresses hold tokenized stocks; Monad holders hold Anchored's aStocks. On Unison they can trade NVDA on a Saturday inside a discovery band that widens with √(time since the close), and they receive a receipt proving no one priced their order before they did.
2. **Market makers, as vault liquidity providers.** The vault quotes both sides, and its LPs deposit or redeem only at a reference published after their request. They earn the spread without being sniped. While the market is closed, a swing fee is paid to the LPs who stay.
3. **Issuers that need their tokens to trade.** Anchored, and every issuer whose product turns over less than 1% a month, need secondary liquidity that doesn't reward a latency race. Unison lists through a per-market adapter and mirrors the issuer's own denylist on chain.
4. **AI agents with a budget.** Agents get:
   - session keys capped by market, size and notional, which can never withdraw;
   - an MCP server;
   - the MetaMask Agent Wallet plugin.

   An agent trades knowing it can't be sniped, and checks its own receipt.

## Against what's there

| Venue | How it prices | Who wins when the price moves |
|---|---|---|
| Continuous order books | Whoever is first at each price | The fastest. Makers pay it in adverse selection, or quote wide |
| Oracle-priced pools | The last price on chain | Whoever sees the next one before it lands: 5.3 chances an hour on MON |
| Monday Trade, on Monad | Continuous trading of Anchored's aStocks, 24/5, since April 2026 | As on any continuous venue, arrival order decides |
| **Unison** | One price per auction, at Chainlink's first observation after its orders were sealed | Nobody: the price doesn't exist until every order is sealed, and the standing challenge pays anyone who shows otherwise |

## How it earns

- **A fee on every fill:** 3 bp today, capped at 10 bp per order. At $10M of fills a day, that is $3,000 a day, about $1.1M a year. For scale, RWA trading on Robinhood Chain ran at $888M a week in August (Pantera).
- **Vault economics:** the vault earns spread and the closed-market swing fee for its LPs. A share for the protocol is a lever, not a default.
- **Licensing the causal clock:** `ChainlinkCausalReference` proves that a Chainlink round is the first observation after a given time. Any oracle-priced AMM or perp can stop leaking to latency by pricing that way. It can be offered as an integration with a revenue share, or as a public good that brings flow to Unison's markets.

## Where it stands, honestly

- **Live on Monad mainnet.** The causal cutover was 6 October 2026. The first causal print passes every check of `verify-receipt.mjs`, observed 6 s after the seal ([mainnet evidence](evidence/mainnet.md)).
- **The standing challenge is funded and running.** The pots are 18 AUSD on Unison's market and 1 AUSD on an old-rule control. Our own open-source sniper trades both with the same signal. On 6 October it was −21.2 bp a trade on Unison and +12.29 bp on the old rule, over 8 fills each, scored by the contract's own definition. That is the claim, measured in public.
- **Outside traders: zero so far,** counted apart from the team at `GET /v1/stats`. The next section is about changing that.
- **Built to be checked.** The repository includes:
  - 111 Foundry tests, plus fuzzing, invariants and a Solidity-versus-TypeScript differential;
  - mainnet-fork rehearsals;
  - a Chainlink CRE sentinel run in simulation against mainnet;
  - an Envio indexer that scores every challenger exactly as the contract does.

## The next 90 days (targets, not results)

| By | Target |
|---|---|
| 31 October 2026 | 25 outside accounts trading on mainnet, counted by `/v1/stats`. The challenge pots and the agent plugin are the invitation. |
| 31 October 2026 | The CRE sentinel and the Nasdaq-halt mirror running on a Chainlink DON, holding `HALT_ROLE` behind the timelock |
| 31 December 2026 | An external audit of the exchange, the causal adapter, the vault and the gateway; caps raised only after it |
| 31 December 2026 | More of Anchored's aStocks on causal markets, each as Chainlink publishes its 24/5 feed |
| 31 March 2027 | A third-party market maker running a vault, and $1M a week of fills |
| 31 March 2027 | The causal clock integrated by one more oracle-priced venue on Monad |

The partners we'll approach first:
- **Anchored:** listings, and seed liquidity for its aStocks.
- **Agora:** AUSD as the quote asset.
- **Chainlink:** more 24/5 tokenized-equity feeds, and production CRE access.
- **Market makers such as Auros:** to run vaults.
- **MetaMask:** distribution through Agent Wallet.

## The risks, and what handles them

| Risk | What handles it |
|---|---|
| Contract risk | Per-market daily caps and small vaults. Admin roles move behind a public timelock (48 h, rising to 7 days) before judging. An audit comes before caps rise, and the full deploy was rehearsed on mainnet forks |
| The oracle | Prices are Chainlink's signed observations, proven first from the feed's history. An AUSD/USD move of more than 50 bp off $1 halts. The CRE sentinel halts a market whose feed is both 75 bp off Coinbase and Kraken and silent for 2 minutes |
| Cold start | The vault quotes from the first block. The challenge brings would-be snipers in the open, where their losses are the proof |
| Regulation | The SEC's TSV conditions are mapped to code. Operating a TSV in the US needs a registered entity or an ATS partner, which is a partnership to make, not code to write |

## Why this team

Unison is built by a founder who has traded both crypto and stocks for a year, and who builds products. Crypto never closes, stocks do, and on-chain the gap is paid to whoever is fastest. This is the venue the founder wanted to trade on.
