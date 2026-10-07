# Unison: voiceover scripts and audio setup

You generate the audio in ElevenLabs **Eleven v4**. I build the visuals and time every cut to your files. Each block below is one file. Short takes let me move a cut without asking you for a new recording.

## 1. How to record with Eleven v4

Eleven v4 has no SSML and no Style or Speed sliders. You direct it with the words themselves:

| Mark | What v4 does with it |
|---|---|
| `[bracketed direction]` | Sets the delivery of the words after it, e.g. `[measured]`, `[quiet certainty]` |
| `…` | A held beat, with weight |
| `—` | A quick break |
| a new line | A breath between thoughts |
| `CAPS` | Emphasis (used twice in the whole script, on purpose) |

**Settings:**

| Setting | Value |
|---|---|
| Model | **Eleven v4**, not v4 Turbo (Turbo is built for live agents) |
| Narrator | **Brian** (or **Daniel** for a British voice). The same voice for every demo, ad and bounty file |
| Pitch | **Your own voice**, an Instant Voice Clone (below) |
| Stability | **55%**. If two files sound like different people, raise it to 65%. If a take sounds flat, lower it to 45% |
| Similarity | **80%** |
| Output | MP3, 44.1 kHz, 192 kbps |

**How to work:**
1. Paste each block exactly as written, brackets included. Don't type the file name.
2. Generate two or three takes and keep the best. Listen for the beat after each line: that's where my cuts land.
3. If v4 ever reads a direction out loud, or one sounds wrong, regenerate. If it keeps happening, delete that one direction and keep the words.

**Your voice for the pitch:**
1. In ElevenLabs, open Voices → Add a new voice → Instant Voice Clone.
2. Upload one to two minutes of you reading anything, recorded on your phone in a quiet room. v4 copies the recording faithfully, room noise included, so a quiet room matters more than ever.
3. Use that voice for the pitch only. It's the founder's story, so it should sound like you.

If you'd rather not, use Brian for the pitch too. Either way, the README's AI disclosure says the narration is generated.

**Pronunciation**, only if a take says it wrong: v4 reads IPA between slashes.

| Word | Should sound like | If it doesn't, write |
|---|---|---|
| Monad | MOH-nad | `/ˈmoʊnæd/` |
| Unison | YOO-nih-sun | `/ˈjuːnɪsən/` |
| Chainlink | CHAIN-link | (fine as is) |

**Saving:** save every file into `C:\Users\Dflame\Music\metropolis\video\audio\`, named exactly as the headings below (for example `demo-01.mp3`).

---

## 2. The demo: "The thirteen seconds"

A Chainlink price is observed about thirteen seconds before it lands on chain. In those seconds, old-rule venues let someone trade against a price that's already old. Unison seals your order before its price exists. The look is a watch movement: Monad's blocks are the ticks, and each auction is the chime.

### demo-01.mp3: cold open
On screen: a watch movement in macro, ticking once per Monad block.
```
[low, unhurried documentary narration] Every price on a blockchain… is already old.
[measured] Chainlink sees the market move —
and about thirteen seconds later, that price finally lands on chain.
```

### demo-02.mp3: the thirteen seconds
On screen: the observation, the move on the exchanges, a trade against the old price; a counter climbs to 5.3 an hour.
```
[a touch of tension] In those thirteen seconds, anyone watching the exchanges already knows the next price.
On most venues… they can still trade against the old one.
[matter-of-fact] We measured it on MON.
FIVE times an hour, the old price was worth sniping.
```

### demo-03.mp3: the idea
On screen: three orders sealed into a block; Chainlink observes; one price strikes through them all.
```
[confident, warm] Unison flips the order.
Your order is sealed first.
[deliberate] Its price is set after —
at Chainlink's very next observation.
One price… for everyone in the auction.
[quiet certainty] Nothing to snipe.
```

### demo-04.mp3: live, part one
On screen: www.unisonfi.com on Monad mainnet; signing in with a passkey.
```
[bright, assured] This is Unison — live on Monad mainnet.
You sign in with a passkey.
No seed phrase. No extension.
```

### demo-05.mp3: live, part two
On screen: a buy of 9 WMON, one tap; its row appears, "Sealed · waits for Chainlink", with the block it was sealed in.
```
[crisp] Buy nine MON, at a limit — one tap.
The order is sealed — right here, in this block.
[lower, intrigued] Its price… doesn't exist yet.
```
*"Sealed" lands as the order's row appears. Then six seconds without a voice: the chain's clock runs, and the music holds one suspended chord while the order waits.*

### demo-06.mp3: the drop
On screen: the fill lands on the beat, "Bought 9 WMON"; then its certificate draws in.
```
[satisfied, quietly triumphant] There.
Chainlink's next observation is in —
and everyone in the auction got the SAME price.
[warm] Every fill gets a certificate…
```

### demo-07.mp3: the receipt
On screen: the trade's receipt page and its three times, from the chain; each time underlined as it's said.
```
[measured] The receipt proves which came first:
the seal…
then its price — observed twenty-four seconds later.
```
*Twenty-four seconds is this trade's own gap (src/data/chain.ts, FILM_TRADE): if the trade is ever filmed again, this line changes with it.*

### demo-08.mp3: don't trust us
On screen: the verifier's six PASS lines type out, one rimshot each.
```
[firm, close to the mic] Don't trust us.
Check.
[measured] One command rebuilds the auction from the chain alone:
the receipt,
Chainlink's observation time,
the seal.
[rising confidence] Six checks.
Six passes.
```

### demo-09.mp3: the photo finish
On screen: two lanes like a race broadcast, our sniper's 3 WMON sale on each rule, then the freeze frame.
```
[controlled sports-broadcast energy] Here's our own sniper —
selling the same three MON, under both rules.
The old rule filled it at a price that was already stale.
Unison priced it after the seal.
[emphatic] Forty basis points apart.
```

### demo-10.mp3: snipe us
On screen: the live challenge page, both pots and every challenger; then a week of real prices.
```
[dry confidence] So we put money on it.
A standing challenge pays anyone who beats the rule — and the board shows every challenger.
Over a week of real prices,
our sniper wins on the old rule…
and loses on Unison.
```

### demo-11.mp3: agents, and a sentinel
On screen: MetaMask's Agent Wallet trading through mm-plugin-unison; the Chainlink CRE sentinel.
```
[lighter, brisk] Agents can trade it too.
Through MetaMask's Agent Wallet, an agent sells in a sealed auction…
then checks its own receipt.
[measured] And we built a Chainlink sentinel that checks the feed against two exchanges, every thirty seconds.
```

### demo-12.mp3: close
On screen: the Unison mark, the live pot, a QR code to the challenge.
```
[warm, resolved] Unison.
Prices nobody saw first.
[a playful dare] Snipe us…
the pot is still full.
```

---

## 3. The pitch, in your voice

Your photo opens and closes it. In between, the proof plays on screen.

### pitch-01.mp3: who
```
[warm, conversational] I'm Dflame.
I've traded crypto and stocks for a year…
and I build products.
[a slight smile] Crypto never closes.
Stocks do.
```

### pitch-02.mp3: the problem
```
[earnest] When I trade a tokenized stock on chain,
the price I get is one somebody faster has already seen.
Every oracle price is about thirteen seconds old when it lands —
and that gap gets paid to whoever is fastest.
```

### pitch-03.mp3: the idea
```
[confident] So I built Unison.
Orders are sealed first,
then priced at Chainlink's very next observation:
one price for everyone,
with a receipt anyone can check.
```

### pitch-04.mp3: proof
```
[steady, proud] It's live on Monad mainnet.
On the same trade, the old rule paid a sniper forty basis points more than Unison did.
Our own sniper runs a standing challenge on both rules.
It wins on the old one…
and loses on ours.
```

### pitch-05.mp3: the market
```
[matter-of-fact] Tokenized stocks just hit a record three point eight billion dollars.
And people want to trade stocks on chain:
in June, stock perpetuals traded sixteen times the volume of the tokens themselves.
[pointed] Issuing the tokens is solved.
Liquid markets for them aren't.
```

### pitch-06.mp3: next, and the ask
```
[forward-looking] Next: an audit, more stocks as Chainlink's feeds arrive,
and market makers running vaults.
[direct, inviting] If you make markets, issue tokenized stocks,
or think you're fast enough…
come snipe us.
[warm] Unison.
Prices nobody saw first.
```

---

## 4. The ad (0:30)

### ad-01.mp3
```
[hushed, intense] Same trade.
Two rules.
[cold] One paid the sniper.
[warm] One priced the order after it was sealed.
[resolved, confident] Unison.
Prices nobody saw first.
Live on Monad.
```

---

## 5. Music and sound effects

**Music.** Generate it in ElevenLabs Music, as two tracks:

`music-demo.mp3`, 3:00:
> Minimal, precise electronic score for a premium fintech product film, 118 BPM, like the inside of a mechanical watch. Clean clockwork ticks on every beat, a deep sub-bass pulse, warm analog pads, sparse piano. 0:00–0:12 a lone ticking motif. 0:12–0:45 builds with light percussion. 0:58–1:12 everything drops away to one suspended, unresolved chord, like a held breath. At 1:12 a full, satisfying drop with drums. 1:12–1:55 confident groove. 1:55–2:30 percussive and energetic, like a sports broadcast. 2:30–2:46 lighter. 2:46–3:00 resolves to one clear bell strike and silence. No vocals.

`music-pitch.mp3`, 2:00 (not made in the end: every film uses `music-demo.mp3`, cut to its own moments):
> Warm, minimal, optimistic piano and soft synth pads, 90 BPM, a gentle clock-tick percussion, building slowly to a confident, resolved ending at 1:50. Understated and premium. No vocals.

I find the drop and the held chord in your track and move the film's cuts onto them, so the timings above are a guide, not a rule.

**Sound effects.** Use ElevenLabs Sound Effects, one file each:

| File | Prompt |
|---|---|
| `sfx-tick.mp3` | a single precise mechanical watch tick, close microphone, clean, dry |
| `sfx-seal.mp3` | a short heavy wax seal stamp thud, satisfying, dry |
| `sfx-chime.mp3` | a single crystal bell strike, pure tone, long natural decay |
| `sfx-pass.mp3` | a short tight percussive hit, like a rimshot, crisp |
| `sfx-whoosh.mp3` | a fast, soft air whoosh transition, modern |
| `sfx-shutter.mp3` | a camera shutter for a photo-finish freeze frame |

That's 34 voice files (19 for the three films, 15 for the bounty videos), 2 music tracks and 6 effects. When they're in `video\audio\`, tell me.

---

## 6. The bounty videos, in the narrator's voice

Each runs about two minutes and shows only real runs: the plugin's mainnet session, the CRE simulator against mainnet, and the indexer's tests and live leaderboard. They use `music-demo.mp3`, cut so it holds its breath on each film's wait, drops on its verdict and rings its last bell on the closing line.

### The MetaMask Agent Wallet plugin

### mm-01.mp3: what it is
```
[clear, upbeat] This is mm-plugin-unison.
It lets an AI agent trade on Unison,
live on Monad mainnet,
through MetaMask's Agent Wallet.
```

### mm-02.mp3: the keys stay with MetaMask
```
[measured] The plugin never holds a key.
Every transaction goes through the Agent Wallet's own executor —
which shows a plain-language intent before it signs.
Reads go straight to Monad.
```

### mm-03.mp3: a sealed sale, on mainnet
```
[engaged] Here's a real run on mainnet.
The agent reads the market,
gets a quote,
and sells ten wrapped MON in a sealed auction.
[lower] Its price doesn't exist yet.
Chainlink observes fourteen seconds later —
and everyone in the auction gets that one price.
```

### mm-04.mp3: the agent checks
```
[measured] Then the agent checks its own receipt,
from the chain alone:
six checks against Chainlink's history.
Six passes.
[dry] It doesn't have to trust us either.
```

### mm-05.mp3: the challenge
```
[inviting] Agents can also enter our standing challenge.
Open a challenge account, trade —
and a contract scores every fill against Chainlink's next price.
Our own sniper is in it:
it wins on the old rule…
and loses on Unison's.
```

### mm-06.mp3: close
```
[confident] Fifteen commands,
twenty-three unit tests,
and seven more against a mainnet fork.
Install it…
and let your agent try to snipe us.
```

### The Chainlink CRE sentinel

### cre-01.mp3: why a second opinion
```
[measured] Unison prices every auction at Chainlink's first observation after its orders are sealed.
The feed is the venue's heartbeat.
So we built it a second opinion —
on Chainlink's own Runtime Environment.
```

### cre-02.mp3: what the workflow does
```
[clear] Every thirty seconds,
each node in the network reads the feed's latest observation on Monad mainnet,
prices MON from Coinbase and Kraken,
and the nodes agree on a median.
```

### cre-03.mp3: the rule
```
[deliberate] It halts only when the feed is far from the market…
and has gone quiet.
A healthy feed trailing a fast move must keep trading —
so a gap alone is never enough.
```

### cre-04.mp3: against mainnet
```
[engaged] Here it is against mainnet, in Chainlink's simulator.
Fourteen basis points apart,
observed sixteen seconds ago:
keep trading.
With the thresholds forced to zero,
it builds the halt report for our receiver contract.
```

### cre-05.mp3: close
```
[calm] A halt moves no funds.
The next auction trades nothing and returns every order.
Lifting it stays with the guardian.
```

### The Envio indexer

### envio-01.mp3: the scoreboard
```
[upbeat] Unison's standing challenge pays anyone who can snipe it.
Envio's HyperIndex keeps the scoreboard:
every challenger, on Monad mainnet.
```

### envio-02.mp3: how
```
[clear] When anyone opens a challenge account,
the factory's event registers the new contract on the fly.
Every order and every fill is indexed —
and each fill is marked to Chainlink's price sixty seconds later,
straight from the feed's own events.
```

### envio-03.mp3: the leaderboard
```
[measured] The result is a public leaderboard on the challenge page,
our own sniper labelled as ours.
It matches the contract's own score, to the last unit —
so what you see is what the pot pays.
```

### envio-04.mp3: close
```
[confident] Its tests replay real mainnet blocks.
Snipe us…
and Envio will show everyone.
```
