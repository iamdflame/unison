# An AI agent's wallet trading on Unison, live on Monad mainnet

On 6 October 2026, from 22:46 UTC, an agent wallet made by MetaMask's `mm` CLI traded on Unison through [`mm-plugin-unison`](../../integrations/agent-wallet-plugin).

**The setup:**
- `mm` 7.0.0, a MetaMask server wallet in Beast mode: `0x5E986eC96d2979f278814452ad08c33C3c0AEA4b`.
- Funded with 100 MON by the team.
- Every transaction was signed by that wallet through the plugin's `ctx.walletExecutor`, each with the intent line shown below. The plugin never held a key.

The wallet is the team's, so its trades are counted with the team's at `GET /v1/stats`, not as outside traders.

## What happened

| Step | Command | Result |
|---|---|---|
| 1 | `mm unison markets` | WMON/AUSD open. Chainlink's newest MON price was 0.028667 AUSD, observed 61 s earlier |
| 2 | `mm unison deposit 10 WMON` | Wrapped 10 MON, approved exactly 10 WMON, deposited: three transactions |
| 3 | `mm unison quote WMON sell 10` | Limit 0.028514 AUSD, 50 bp under Chainlink; locks 10 WMON |
| 4 | `mm unison order WMON sell 10` | Sealed in block 111,160,954. Priced at Chainlink's observation made 8 s later. Sold at 0.028605 AUSD for 0.285964 AUSD. Receipt: 6 of 6 checks. 45 s end to end |
| 5 | `mm unison order WMON buy 9` | Sealed in block 111,161,153. Priced at the observation made 7 s later. Bought at 0.028731 AUSD for 0.258657 AUSD. Receipt: 6 of 6. 48 s |
| 6 | `mm unison receipt https://www.unisonfi.com/receipt/mainnet/1/111160954` | The agent re-checked the sale from the chain alone: 6 of 6 |
| 7 | `mm unison withdraw all WMON` and `… all AUSD` | 9 WMON and 0.027307 AUSD back in the wallet |

The round trip cost the vault's spread and two fees: the sale cleared 18.84 bp under Chainlink's price, and the purchase 22.32 bp over it. The agent's seven transactions cost 0.112 MON of gas in all, about a third of a cent. The keeper paid for the two auctions and the two settlements.

## The sale, as the agent saw it

```
$ mm unison order WMON sell 10
Intent: Unison: sealed sell of 10 WMON at ≥ 0.028502 AUSD, priced at Chainlink's next observation
Tx submitted: https://monadvision.com/tx/0xdeb070f9b98975fe8f2cf51b8f485876752a7d7169e1daa5e36a47bf119d7039
  ✓ Unison: sealed sell of 10 WMON at ≥ 0.028502 AUSD, priced at Chainlink's next observation
Sealed in block 111160954. Its price doesn't exist yet: the auction prices at Chainlink's first observation after this block.
Priced: 0.028605 AUSD, one price for everyone in the auction (Chainlink: 0.028659).
Receipt: 6 of 6 checks pass against Chainlink's own history. https://www.unisonfi.com/receipt/mainnet/1/111160954
status:  filled
auction:
  price: 0.028605 AUSD
  chainlinkReference: 0.028659 AUSD
  upToBlock: 111160954
  clearedInBlock: 111161027
  observedAfterSealSec: 8
fill:
  sold: 10 WMON
  received: 0.285964 AUSD
  fee: 0.000086 AUSD
  claimedBy: keeper
receipt:
  chainlink:
    round: 18446744073710160724
    observedAt: 2026-10-06T22:48:31.000Z
    landedOnChainAt: 2026-10-06T22:48:44.000Z
    sealedAt: 2026-10-06T22:48:23.000Z
  checks:
    - PASS  receipt hash recomputes: 0x71bb199b56e60a9ca07afe3e4df2fd353b6d0f0c28f198949ce33ab8c98299e8
    - PASS  the receipt's reference time is Chainlink's observation time (1791326911)
    - PASS  observed strictly before the report landed on chain (a signed observation, not a block time)
    - PASS  the newest order was sealed in block 111160954, at 1791326903
    - PASS  observed 8 s after the seal (more than the 2 s skew)
    - PASS  the round before it was observed at 1791326881, not after the seal: no earlier observation qualified
```

The order's price did not exist when it was signed. It was sealed at 22:48:23, and Chainlink's oracles observed MON at 22:48:31. Their report landed on chain at 22:48:44, and the auction cleared at that observation. The agent then proved this itself, from Chainlink's own history.

## Every transaction

| What | Transaction |
|---|---|
| Wrap 10 MON | [0xe9244d37…](https://monadvision.com/tx/0xe9244d377e25b4d4e03940d76a513658594343cc166ef18d94f5018500399db2) |
| Approve exactly 10 WMON | [0xf2ad28be…](https://monadvision.com/tx/0xf2ad28be42c3b441302d3f5bfdc00ff0452c3b36cb90d6b9b28ce22eca444632) |
| Deposit 10 WMON | [0xee82d911…](https://monadvision.com/tx/0xee82d911e18b59ccf753590c9ce9bcd4163684d9408dfe38e122a45e77089f79) |
| Sealed sell of 10 WMON | [0xdeb070f9…](https://monadvision.com/tx/0xdeb070f9b98975fe8f2cf51b8f485876752a7d7169e1daa5e36a47bf119d7039) |
| Its auction (cleared by the keeper) | [0xdb9ce3c6…](https://monadvision.com/tx/0xdb9ce3c65426143949b193b9cad3a13d94bce3b6e1420cd824d06a1f04955c1f) |
| Its settlement (claimed by the keeper) | [0x69d8dcfc…](https://monadvision.com/tx/0x69d8dcfc01669015957489f86c497037cf0ed7b4c7e365ff8c8d78252aab6aea) |
| Sealed buy of 9 WMON | [0xe5641ee8…](https://monadvision.com/tx/0xe5641ee8e2e05116e3cf7f8fb2d81aba337d4d8aa6f9a63d25214c698ca7b18d) |
| Its auction | [0xe1ba7ba1…](https://monadvision.com/tx/0xe1ba7ba1e16655b7003045b92826326681c053b0e42ac224c631f775fdd10876) |
| Its settlement | [0x4dc13f7c…](https://monadvision.com/tx/0x4dc13f7cf68a70672c5bdba83de76b939a675296fc7cf2637b2972fd49e886e7) |
| Withdraw 9 WMON | [0x9ea96843…](https://monadvision.com/tx/0x9ea968436eeba62d621f60b2e952bda51d0be1bd3c890463b525678d9f942f37) |
| Withdraw 0.027307 AUSD | [0x996fea50…](https://monadvision.com/tx/0x996fea501e5157fd4dec9fbae17c455fb6daae0e5fd3e52becea48b4390e2ed0) |

The two receipts: https://www.unisonfi.com/receipt/mainnet/1/111160954 and https://www.unisonfi.com/receipt/mainnet/1/111161153.
