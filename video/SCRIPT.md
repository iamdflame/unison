# Unison: voiceover scripts and audio setup

You generate the audio in ElevenLabs. I build the visuals and time every cut to your files. Each line below is one file. Short takes let me move a cut without asking you for a new recording.

## 1. ElevenLabs settings

| Setting | Value |
|---|---|
| Model | **Eleven Multilingual v2**. It is the steadiest for narration and honours `<break time="…"/>`. |
| Voice | Narration: **Brian**, or **Daniel** if you prefer a British voice. Pitch: **your own voice**, cloned (below). |
| Stability | 50% |
| Similarity | 75% |
| Style exaggeration | 20% |
| Speaker boost | On |
| Speed | 1.0. If a take runs long, use 1.05 rather than cutting words. |
| Output | MP3, 44.1 kHz, 192 kbps |

**Your voice for the pitch:**
1. In ElevenLabs, open Voices → Add a new voice → Instant Voice Clone.
2. Upload one to two minutes of you reading anything, recorded on your iPhone in a quiet room.
3. Use that voice for the pitch lines only. It's the founder's story, so it should sound like you.

If you'd rather not, use Brian for the pitch too. Either way, the README's AI disclosure will say the narration is generated.

**Pronunciation**, if a take says it wrong:

| Word | Should sound like | If it doesn't, type |
|---|---|---|
| Monad | MOH-nad | `Moe-nad` |
| Chainlink | CHAIN-link | (fine as is) |
| Unison | YOO-nih-sun | `You-nih-sun` |
| basis points | spelled out | (already spelled out below) |

**Saving:** save every file into `C:\Users\Dflame\Music\metropolis\video\audio\`, named exactly as the headings below (for example `demo-01.mp3`). Generate each line on its own, and keep the take you like best.

---

## 2. The demo (2:58): "The thirteen seconds"

The idea runs through the whole film. A Chainlink price is observed about 13 seconds before it lands on chain, and in those seconds old-rule venues let someone trade against a price that is already old. Unison seals your order before its price exists. The look is a watch movement: Monad's blocks are the ticks, and each auction is the chime.

### demo-01.mp3: cold open (0:00–0:12)
On screen: a watch movement in macro, cut to Unison's dial ticking with live Monad blocks.
```
Every price on a blockchain is already old. <break time="0.5s" /> Chainlink observes the market… <break time="0.4s" /> and thirteen seconds later, that price lands on chain.
```

### demo-02.mp3: the thirteen seconds (0:12–0:30)
On screen: a timeline from observation to landing, with a sniper trading in the gap. A counter climbs to 5.3 an hour.
```
In those thirteen seconds, anyone watching the market already knows the next price. <break time="0.4s" /> On most venues, they get to trade against the old one. <break time="0.4s" /> We measured it on MON: <break time="0.2s" /> five times an hour, the old price was worth sniping.
```

### demo-03.mp3: the idea (0:30–0:45)
On screen: an order sealed into a block; the next observation lands; one price strikes through the batch.
```
Unison flips the order. <break time="0.4s" /> Your order is sealed first. <break time="0.3s" /> Its price is set after, <break time="0.2s" /> at Chainlink's very next observation. <break time="0.4s" /> One price for everyone in the auction. <break time="0.3s" /> Nothing to snipe.
```

### demo-04.mp3: live, part one (0:45–0:58)
On screen: www.unisonfi.com on mainnet. Sign in with a passkey.
```
This is Unison, live on Monad mainnet. <break time="0.4s" /> You sign in with a passkey: <break time="0.3s" /> no seed phrase, no extension.
```

### demo-05.mp3: live, part two (0:58–1:06)
On screen: a WMON sell. The ticket reads "Sealed · waiting for Chainlink".
```
Sell some MON. <break time="0.4s" /> The order is sealed in this block. <break time="0.5s" /> Its price doesn't exist yet.
```
*Then six seconds without a voice. The music holds one suspended chord while the order waits.*

### demo-06.mp3: the drop (1:12–1:35)
On screen: the observation lands on the beat, the order fills, and the certificate draws in.
```
There. <break time="0.5s" /> Chainlink's next observation is in, <break time="0.3s" /> and everyone in the auction got the same price. <break time="0.5s" /> The certificate shows every step, <break time="0.2s" /> in the order it happened.
```

### demo-07.mp3: don't trust us (1:35–1:55)
On screen: six PASS lines type out, one percussion hit each, then the transaction on the explorer.
```
Don't trust us. <break time="0.6s" /> Check. <break time="0.6s" /> One command rebuilds the auction from the chain alone: <break time="0.3s" /> the receipt, <break time="0.2s" /> Chainlink's observation time, <break time="0.2s" /> the seal. <break time="0.4s" /> Six checks. <break time="0.3s" /> Six passes.
```

### demo-08.mp3: the photo finish (1:55–2:12)
On screen: split screen like a race broadcast. Our sniper's 3 WMON sale on each rule, block numbers and prices racing, then a freeze-frame finish line.
```
Here is our own sniper, <break time="0.2s" /> selling the same three MON under both rules. <break time="0.4s" /> The old rule filled it at a price that was already stale. <break time="0.3s" /> Unison priced it after the seal. <break time="0.5s" /> Forty basis points apart.
```

### demo-09.mp3: snipe us (2:12–2:30)
On screen: the challenge board, both pots live, the Envio leaderboard, then a week of trades flowing as a river of points.
```
So we put money on it. <break time="0.3s" /> A standing challenge pays anyone who beats the rule. <break time="0.4s" /> Over a week of real prices, <break time="0.2s" /> our sniper wins on the old rule, <break time="0.3s" /> and loses on Unison.
```

### demo-10.mp3: agents, and a sentinel (2:30–2:46)
On screen: a terminal. `mm unison order WMON sell 10` through MetaMask's Agent Wallet, its receipt verified. Then the CRE sentinel's dial, labelled as running in Chainlink's simulator.
```
Agents can trade it too. <break time="0.3s" /> Through MetaMask's Agent Wallet, an agent sells in a sealed auction, <break time="0.2s" /> then checks its own receipt. <break time="0.4s" /> And we built a Chainlink sentinel that checks the feed against two exchanges, every thirty seconds.
```

### demo-11.mp3: close (2:46–2:58)
On screen: the Unison mark, the live pot, a QR code to /challenge.
```
Unison. <break time="0.5s" /> Prices nobody saw first. <break time="0.8s" /> Snipe us. <break time="0.4s" /> The pot is still full.
```

---

## 3. The pitch (1:55), in your voice

Your photo (`Downloads\Dflame.jpg`) opens and closes it. In between, the proof plays on screen.

### pitch-01.mp3: who (0:00–0:14)
```
I'm Dflame. <break time="0.4s" /> I've traded crypto and stocks for a year, <break time="0.2s" /> and I build products. <break time="0.5s" /> Crypto never closes. <break time="0.3s" /> Stocks do.
```

### pitch-02.mp3: the problem (0:14–0:34)
```
When I trade a tokenized stock on chain, <break time="0.2s" /> the price I get is one somebody faster has already seen. <break time="0.4s" /> Every oracle price is thirteen seconds old when it lands, <break time="0.3s" /> and that gap gets paid to whoever is fastest.
```

### pitch-03.mp3: the idea (0:34–0:49)
```
So I built Unison. <break time="0.4s" /> Orders are sealed first, <break time="0.2s" /> then priced at Chainlink's very next observation: <break time="0.3s" /> one price for everyone, <break time="0.2s" /> with a receipt anyone can check.
```

### pitch-04.mp3: proof (0:49–1:10)
```
It's live on Monad mainnet. <break time="0.4s" /> On the same trade, the old rule paid a sniper forty basis points more than Unison did. <break time="0.4s" /> Our own sniper runs a standing challenge on both rules. <break time="0.3s" /> It wins on the old one, <break time="0.2s" /> and loses on ours.
```

### pitch-05.mp3: the market (1:10–1:30)
```
Tokenized stocks just hit a record three point eight billion dollars. <break time="0.4s" /> But Pantera found that tokenized securities are fifty-nine percent of the market's value, <break time="0.2s" /> and zero point two percent of its trading. <break time="0.5s" /> Issuance isn't the problem. <break time="0.3s" /> Liquidity is.
```

### pitch-06.mp3: next, and the ask (1:30–1:55)
```
Next: an audit, more stocks as Chainlink's feeds arrive, <break time="0.2s" /> and market makers running vaults. <break time="0.4s" /> If you make markets, issue tokenized stocks, <break time="0.2s" /> or think you're fast enough, <break time="0.3s" /> come snipe us. <break time="0.6s" /> Unison. <break time="0.3s" /> Prices nobody saw first.
```

---

## 4. The ad (0:30)

### ad-01.mp3
```
Same trade. <break time="0.4s" /> Two rules. <break time="0.6s" /> One paid the sniper. <break time="0.5s" /> One priced the order after it was sealed. <break time="0.8s" /> Unison. <break time="0.4s" /> Prices nobody saw first. <break time="0.3s" /> Live on Monad.
```

---

## 5. Music and sound effects

**Music.** Generate it in ElevenLabs Music, as two tracks:

`music-demo.mp3`, 3:00:
> Minimal, precise electronic score for a premium fintech product film, 118 BPM, like the inside of a mechanical watch. Clean clockwork ticks on every beat, a deep sub-bass pulse, warm analog pads, sparse piano. 0:00–0:12 a lone ticking motif. 0:12–0:45 builds with light percussion. 0:58–1:12 everything drops away to one suspended, unresolved chord, like a held breath. At 1:12 a full, satisfying drop with drums. 1:12–1:55 confident groove. 1:55–2:30 percussive and energetic, like a sports broadcast. 2:30–2:46 lighter. 2:46–3:00 resolves to one clear bell strike and silence. No vocals.

`music-pitch.mp3`, 2:00:
> Warm, minimal, optimistic piano and soft synth pads, 90 BPM, a gentle clock-tick percussion, building slowly to a confident, resolved ending at 1:50. Understated and premium. No vocals.

**Sound effects.** Use ElevenLabs Sound Effects, one file each:

| File | Prompt |
|---|---|
| `sfx-tick.mp3` | a single precise mechanical watch tick, close microphone, clean, dry |
| `sfx-seal.mp3` | a short heavy wax seal stamp thud, satisfying, dry |
| `sfx-chime.mp3` | a single crystal bell strike, pure tone, long natural decay |
| `sfx-pass.mp3` | a short tight percussive hit, like a rimshot, crisp |
| `sfx-whoosh.mp3` | a fast, soft air whoosh transition, modern |
| `sfx-shutter.mp3` | a camera shutter for a photo-finish freeze frame |

That's 18 voice files, 2 music tracks and 6 effects. When they're in `video\audio\`, tell me. The bounty videos (MetaMask, Chainlink CRE and Envio) get their own short scripts next.
