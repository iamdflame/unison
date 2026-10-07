# YouTube: the six uploads

Each film's file, thumbnail and subtitles are in `video/out/` after a render (`node capture/master.mjs …`, `node capture/thumbs.mjs`, `node capture/subtitles.mjs …`). Every number below is the films' own (src/data) and checked against the chain or the evidence in `docs/evidence/`. Chapter times are the films' beat starts.

| Film | Upload | Thumbnail | Subtitles | Length |
|---|---|---|---|---|
| Demo | `out/Demo-master.mp4` | `out/thumbs/Demo.png` | `out/Demo.srt` | 2:32 |
| Pitch | `out/Pitch-master.mp4` | `out/thumbs/Pitch.png` | `out/Pitch.srt` | 1:38 |
| Ad | `out/Ad-master.mp4` | `out/thumbs/Ad.png` | `out/Ad.srt` | 0:21 |
| MetaMask | `out/MetaMask-master.mp4` | `out/thumbs/MetaMask.png` | `out/MetaMask.srt` | 1:16 |
| CRE | `out/Cre-master.mp4` | `out/thumbs/Cre.png` | `out/Cre.srt` | 1:04 |
| Envio | `out/Envio-master.mp4` | `out/thumbs/Envio.png` | `out/Envio.srt` | 0:48 |

## Settings for all six

- **Visibility:** Public, so the challenge gets seen (traction is 20% of the score). Unlisted also works for judging.
- **Category:** Science & Technology. **Audience:** No, it's not made for kids.
- **Subtitles:** Studio → Subtitles → English → Upload file → *With timing* → the `.srt`. The drawn scenes carry no burned-in captions, so this is what muted viewers read.
- **Altered or synthetic content:** the narration is an AI voice. Answer **Yes** for the Pitch if its voice is a clone of yours (a realistic voice of a real person). The others use a stock voice and need no label; their descriptions disclose it anyway.
- **Playlist:** put all six in one, "Unison · Monad Metropolis", in the order above.
- **Language:** English. **Comments:** on.

---

## 1. Demo

**Title:** Unison: Priced After the Seal. A Live Demo on Monad Mainnet

**Alternative:** The Exchange Snipers Can't Beat: Unison, Live on Monad Mainnet

**Tags:** Unison, Monad, Chainlink, batch auction, latency arbitrage, MEV, tokenized stocks, DeFi, oracle, Monad Metropolis

```text
A real trade on Monad mainnet, priced at Chainlink's first observation after the order was sealed. When the order went in, nobody could see that price, not even us.

Unison is a uniform-price batch auction. Orders are sealed into a Monad block first; the auction then clears at the first Chainlink observation made after the seal, and everyone in it gets that one price.

Everything on screen is real:
• A buy of 9 WMON, sealed in auction 111,237,596 on 7 Oct 2026 at 05:14:03 UTC. Chainlink observed 24 s later, and it cleared at 0.026972 AUSD.
  Receipt: https://www.unisonfi.com/receipt/mainnet/1/111237596
• That receipt, checked 6 of 6 from the chain alone.
• A photo finish: on 6 Oct our own sniper sold the same 3 WMON under both rules. The old rule filled it at $0.029059, a price that was already stale; Unison priced it after the seal at $0.028942. 40 bp apart.
  Old rule: https://monadvision.com/tx/0xa16a661d3d200629a1bf09de7348f1cf4702dec8302a680a90445cc85a33b180
  Unison: https://monadvision.com/tx/0x128b8b18f4ae90cf0f79f439f5886f2f3ff548f2ebb3dcd7a847c2284351596e
• Over a week of real prices (208,414 Coinbase trades, 15,992 Chainlink rounds), a sniper earns +17.8 bp a trade on the old rule and loses 23.0 bp on Unison.

Snipe us: a standing challenge pays anyone who beats the rule. 18 AUSD in the pot.
https://www.unisonfi.com/challenge

Try it: https://www.unisonfi.com
Code: https://github.com/iamdflame/unison

Chapters
0:00 Cold open
0:12 The 13 seconds
0:27 The idea: seal first, price after
0:41 Live on Monad mainnet
1:30 Don't trust us. Check.
1:43 Photo finish
1:56 The standing challenge
2:10 An agent, a sentinel, and the pot

Built for Monad Metropolis (Track 01). The narration is an AI voice (ElevenLabs Eleven v4); music and sound effects were generated with ElevenLabs. The footage is the live site on Monad mainnet, and every terminal line is the program's own output.

#Monad #Chainlink #DeFi
```

## 2. Pitch

**Title:** Snipers Lose Here: the Unison Pitch (Monad Metropolis)

**Alternative:** Unison: Prices Nobody Saw First. A Founder's Pitch

**Tags:** Unison, Monad, tokenized stocks, Chainlink, batch auction, market structure, DeFi, startup pitch, Monad Metropolis

```text
I'm Dflame. I've traded crypto and stocks for a year, and I build products. This is Unison: an exchange that prices your order after it's sealed, so nobody trades against a price they saw first.

The problem: an oracle price is about 13 seconds old when it lands on chain, and that gap gets paid to whoever is fastest. On MON, the old price was worth sniping about five times an hour.

The fix: Unison seals every order into a Monad block, then prices the whole auction at Chainlink's first observation after the seal. One price for everyone.

The proof, live on Monad mainnet:
• On the same trade, the old rule paid our sniper 40 bp more than Unison did.
• Our own sniper runs a standing challenge on both rules. It wins on the old one and loses on ours: +14.49 bp against −22.24 bp over 23 fills each (7 Oct 2026, 14:17 UTC).
• Every fill has a receipt anyone can check against Chainlink's own history.

The market: tokenized stocks hit a record $3.8B (Crypto Briefing, 6 Oct 2026, citing RWA.xyz). In June, stock perpetuals traded $67.8B, 16× the spot volume of the tokens themselves (Pantera, State of Tokenization). Issuing the tokens is solved. Liquid markets for them aren't.
https://cryptobriefing.com/tokenized-stocks-record-market-cap/
https://panteracapital.com/state-of-tokenization/

Next: an audit, more stocks as Chainlink's feeds arrive, and market makers running vaults. If you make markets, issue tokenized stocks, or think you're fast enough: come snipe us.

https://www.unisonfi.com
https://www.unisonfi.com/challenge
https://github.com/iamdflame/unison

Chapters
0:00 Who I am
0:12 The problem
0:27 The idea
0:39 Proof on mainnet
1:00 The market
1:18 What's next

Built for Monad Metropolis (Track 01). The narration reads my own words in an AI voice (ElevenLabs Eleven v4); music and sound effects were generated with ElevenLabs. Every number on screen is real and sourced.

#Monad #TokenizedStocks #DeFi
```

## 3. Ad

**Title:** Same Trade. Same Second. Two Prices. | Unison

**Alternative:** The Old Rule Paid the Sniper 40 bp. Unison Didn't.

**Tags:** Unison, Monad, Chainlink, MEV, latency arbitrage, DeFi, batch auction

```text
Same trade. Two rules. One paid the sniper. One priced the order after it was sealed.

On 6 October 2026, our own sniper sold the same 3 WMON on Monad mainnet under both rules. The old rule filled it at $0.029059, a price that was already stale. Unison sealed the order first and priced it at Chainlink's next observation: $0.028942. Forty basis points apart.

Old rule: https://monadvision.com/tx/0xa16a661d3d200629a1bf09de7348f1cf4702dec8302a680a90445cc85a33b180
Unison: https://monadvision.com/tx/0x128b8b18f4ae90cf0f79f439f5886f2f3ff548f2ebb3dcd7a847c2284351596e

Unison. Prices nobody saw first. Live on Monad.
https://www.unisonfi.com
Snipe us: https://www.unisonfi.com/challenge

AI voice (ElevenLabs Eleven v4); music and effects generated with ElevenLabs. The footage is the live site, and the numbers are on chain.

#Monad #Chainlink #DeFi
```

## 4. MetaMask Agent Wallet plugin

**Title:** An AI Agent Trades on Monad Mainnet: mm-plugin-unison for MetaMask Agent Wallet

**Alternative:** Let Your AI Agent Trade on Unison: mm-plugin-unison (MetaMask Agent Wallet)

**Tags:** MetaMask, Agent Wallet, AI agent, mm-plugin-unison, Monad, Unison, Chainlink, DeFi, Monad Metropolis

```text
mm-plugin-unison lets an AI agent trade on Unison, live on Monad mainnet, through MetaMask's Agent Wallet. The plugin never holds a key: every transaction goes through the Agent Wallet's own executor, which shows a plain-language intent before it signs.

A real run, 7 October 2026. Every terminal line is the plugin's own output:
• The agent reads the market: WMON/AUSD at 0.027249 on Chainlink.
• It gets a quote, then sells 10 WMON in a sealed auction, at no less than 0.026772 AUSD.
• Sealed in block 111,202,438. Its price didn't exist yet.
• Chainlink observed 14 s after the seal, and everyone in the auction got 0.027168 AUSD.
• The agent checks its own receipt against Chainlink's history: 6 of 6 checks pass.
  https://www.unisonfi.com/receipt/mainnet/1/111202438

Agents can enter the standing challenge too: open a challenge account, trade, and a contract scores every fill against Chainlink's price a minute later. Our own sniper wins on the old rule and loses on Unison's.

15 commands · 23 unit tests · 7 more against a mainnet fork

Install: mm plugins install mm-plugin-unison
(On Windows, the plugin's README has a one-line workaround for a MetaMask CLI install bug.)
npm: https://www.npmjs.com/package/mm-plugin-unison
Code: https://github.com/iamdflame/unison/tree/main/integrations/agent-wallet-plugin
Challenge: https://www.unisonfi.com/challenge

Chapters
0:00 mm-plugin-unison
0:10 The plugin never holds a key
0:22 A real sale on mainnet
0:39 The agent checks its receipt
0:50 The standing challenge
1:05 Install it

Built for Monad Metropolis (MetaMask Agent Wallet bounty). AI voice (ElevenLabs Eleven v4); music and effects generated with ElevenLabs.

#MetaMask #AIAgents #Monad
```

## 5. Chainlink CRE sentinel

**Title:** Keep Trading or Halt: a Chainlink CRE Sentinel for Unison's Price Feed

**Alternative:** A Second Opinion for the Oracle: a Chainlink CRE Sentinel on Monad Mainnet

**Tags:** Chainlink, CRE, Chainlink Runtime Environment, oracle, Monad, Unison, circuit breaker, DeFi, Monad Metropolis

```text
Unison prices every auction at Chainlink's first observation after its orders are sealed, so the feed is the venue's heartbeat. This sentinel, built on Chainlink's Runtime Environment (CRE), is its second opinion.

Every 30 seconds, each node of the network:
• reads the feed's latest observation on Monad mainnet: its price, and when Chainlink observed it,
• prices MON on Coinbase and Kraken,
• then the nodes agree on a median.

It halts only when the feed is far from the market (more than 75 bp) and has also gone quiet (no observation for 120 s). A healthy feed trailing a fast move must keep trading, so a gap alone is never enough. The cases shown are the workflow's own unit tests.

Against mainnet, in Chainlink's simulator (CRE CLI 1.36, 7 Oct 2026, 02:26 UTC):
• Production settings: feed 0.027045 vs exchanges 0.027007, 14 bp apart, observed 16 s ago: MON:ok:14bp:16s. Keep trading.
• Thresholds forced to zero, same reads: MON:HALT:14bp:25s, and the halt report for our receiver contract.

A halt moves no funds: the next auction trades nothing and returns every order. Lifting it stays with the guardian.

Status: the workflows run against Monad mainnet in Chainlink's simulator. Deploying to a live DON waits for CRE deploy access.
Logs: https://github.com/iamdflame/unison/blob/main/docs/evidence/cre.md
Code: https://github.com/iamdflame/unison/tree/main/cre/unison
Unison: https://www.unisonfi.com

Chapters
0:00 The feed is the heartbeat
0:13 Every 30 seconds, a second opinion
0:27 The rule: far off, and silent
0:39 Against mainnet, in the simulator

Built for Monad Metropolis (Chainlink CRE bounty). AI voice (ElevenLabs Eleven v4); music and effects generated with ElevenLabs.

#Chainlink #Monad #DeFi
```

## 6. Envio HyperIndex scoreboard

**Title:** Snipe Us: Envio HyperIndex Scores Every Challenger on Monad Mainnet

**Alternative:** A Leaderboard That Matches the Contract to the Last Unit: Envio HyperIndex on Monad

**Tags:** Envio, HyperIndex, indexer, GraphQL, Monad, Unison, Chainlink, DeFi, Monad Metropolis

```text
Unison's standing challenge pays anyone who can snipe it: 18 AUSD in the pot on Unison's rule, 1 AUSD on the old rule as a control. Envio HyperIndex keeps the scoreboard: every challenger, on Monad mainnet.

How the indexer works (services/indexer):
• Factory pattern: LatencyChallenge's Opened event registers each new ChallengeAccount on the fly (contractRegister).
• Every order and every fill is indexed (OrderSent, FillRecorded).
• Each fill is marked to Chainlink's first MON/USD observation at least 60 s after its order, straight from the feed's own NewTransmission events. AUSD/USD's rounds price the quote side, as the contract does.

The result is the public leaderboard at https://www.unisonfi.com/challenge, with our own sniper labelled as ours. It matches the contract's own score to the last unit: on 7 Oct 2026 at 14:17 UTC, Envio and LatencyChallenge both gave −0.004250 AUSD for Unison's rule and +0.002772 AUSD for the old rule, over 23 fills each.

Its tests replay real mainnet blocks: 8 of 8 pass in CI.

GraphQL: https://indexer.dev.hyperindex.xyz/c37634b/v1/graphql
Code: https://github.com/iamdflame/unison/tree/main/services/indexer

Chapters
0:00 The standing challenge
0:10 Every challenger, registered on the fly
0:26 The live leaderboard

Built for Monad Metropolis (Envio bounty). AI voice (ElevenLabs Eleven v4); music and effects generated with ElevenLabs.

#Envio #Monad #DeFi
```
