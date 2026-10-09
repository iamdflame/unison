# TSV compliance: rule → code

SEC Release 34-106402 (September 17, 2026, the "innovation exemption") lets **Tokenized Securities Venues** trade tokenized NMS stocks through permissioned AMM pools, under conditions.

Unison treats each condition as an engineering requirement. Each one is enforced on-chain where possible and recorded on-chain where enforcement belongs off-chain.

> **An engineering map, not a licence.** This is how the venue *could* implement the conditions as we read them. It is not legal advice, and nothing here makes Unison a TSV: operating one requires the registered entity (or a broker-dealer/ATS partner) and its counsel. The release, as summarised here, concerns permissioned AMM pools; Unison is a batch auction, and whether any exemption fits it is a question for counsel. **What the mainnet beta enforces today is only the issuer's denylist:** no market is permissioned, there is no KYC at order entry, and "not offered to US persons" is a policy, not an on-chain check.

| Condition (as summarised from the release) | Unison implementation | Where | Test |
|---|---|---|---|
| **Symbol limits by LULD tier.** Tier 1 ≤ 75 symbols, tier 2 ≤ 250. | Every market carries a tier. Assigning a symbol to a full tier reverts. Tiers can be changed and slots are freed. | `UnisonExchange.setTier`, `TIER1_SYMBOL_LIMIT` / `TIER2_SYMBOL_LIMIT` | `ComplianceTest.test_tierSymbolLimits` |
| **Volume caps as a fraction of ADV per tier** (e.g. tier 1: 0.25% of ADV, tier 2: 2.5%) | A daily cap in shares is written from ADV each day (`CAP_ROLE`: the CRE ADV workflow or the operator). The cap is enforced inside the auction: the price is still discovered uncapped, executed volume is capped and allocated with the same exact pro-rata. An exhausted cap means no auction until the next UTC day. | `setDailyCap`, `Clearing.Input.maxVolume`, `ExchangeClearing._capRemaining` | `test_dailyVolumeCap_limitsAuction_thenResetsAtUtcMidnight`; differential fuzz covers capped auctions |
| **Trading-stoppage coordination:** mirror primary-market halts and limit up/limit down. | Primary halts are mirrored through `HALT_ROLE` (guardian, CRE halt workflow) and through reference status `HALTED`, and no auction runs. After a halt, the first auction is a reopening auction. Every auction runs inside a band around the reference (LULD-like), and DISCOVERY bands are capped at the asset's weekend-gap p99. | `setHalt`, regimes, `_regimeBandBps` | `RegimeTest.test_haltOverride_blocksAuction_thenReopens` |
| **Public trade data** | Every auction emits `BatchCleared`: price, volume, reference, status, band, receipt hash. Every fill is visible through `Claimed` / `CurveFilled`. The tape is fully reconstructable from chain data. | `ExchangeBase` events | e2e prints |
| **Books and records** | A per-batch receipt hash chain: `receiptHash = keccak(prev, market, batch, tick, volume, ref, refTime, status, timestamp)`. Order and fill events. Attestation references (`AttestationEligibility.ref`) tie KYC records to on-chain eligibility without exposing personal data. | `_finalize`, `AttestationEligibility` | — |
| **Permissioned participation** (eligible investors only) | Permissioned markets check eligibility at order entry. Restricted tokens check it at deposit and withdrawal. `EligibilityRouter` = KYC attestation (jurisdiction blocklist, investor class, expiry) **AND** every issuer denylist, mirrored from the token's own compliance contract (Anchored). Gateway-relayed actions are checked against the real account, not the relayer. | `compliance/*`, `_requireEligible`, `placeOrderFor` | `test_eligibility_attestation_jurisdiction_class_issuerDenylist`, `MonadForkTest` (live Anchored denylist) |
| **Disclosure / public notices** | Document hashes and URIs are posted on-chain per market or venue-wide. | `postNotice` → `NoticePosted` | `test_publicNotice` |
| **Fair access, no preferential treatment** | Uniform price per batch. Arrival time inside a batch is irrelevant. Pro-rata at the marginal price with exact apportionment. Shards prevent any account from congesting another. | `Clearing`, `OrderMath.apportion` | `UnisonExchangeTest.test_proRata_sameBlockBuyersShareEqually`; fairness benchmark |

## Off-chain responsibilities (operator)

These belong to the operator:

| Responsibility | Mechanism |
|---|---|
| KYC/AML for participants | Cleanverse A-Pass → attester service → `attest()` |
| Licensed market data for references | The mainnet beta reads Chainlink's tokenized-equity feeds; at scale, Pyth Pro or Chainlink Data Streams |
| Computing ADV daily | CRE workflow → `setDailyCap` |
| Monitoring primary-market halts | CRE workflow → `setHalt` (a dry run in Chainlink's simulator today; it holds no role) |
| Filing and record retention | — |

The contracts make each step **checkable**: every action leaves an event or a hash on-chain.

**In the mainnet beta today:**
- aNVDA is a restricted token; the venue mirrors Anchored's denylist at every deposit and withdrawal (`IssuerDenylistEligibility`), without KYC.
- No market is permissioned (`permissioned: false` on all three): anyone not on Anchored's denylist can trade.
- Each market has a daily cap.
- Prints, receipts and the receipt chain are public on the tape.
- KYC attestations, tiers and an operator of record come before the venue grows.
