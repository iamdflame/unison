import { AbsoluteFill, interpolate, Sequence } from "remotion";
import { C, F, s } from "../brand";
import { FILM_TRADE as T } from "../data/chain";
import { clamp01, Flash, glow, pop, Ring, useT } from "../kit/Fx";
import { type Beat, Film, plan, type PlanProps, useLine } from "../kit/Plan";
import { Shot } from "../kit/Screen";
import { Close } from "../scenes/Close";
import { PhotoFinish } from "../scenes/PhotoFinish";
import { MUSIC_DEMO } from "./Demo";

/**
 * The ad (≤ 0:30), SCRIPT.md §4. Four seconds of the live product cut on the beat (a buy, sealed, one price, priced
 * after the seal), then the photo finish raced while the music falls away, its shutter on the drop with "One paid
 * the sniper.", and the name on the bell. The music is 118 bpm: in the ad its beats fall at 0.32 s and every 0.5085 s
 * after, its eight-beat hits at 1.85 s and 5.92 s, and the drop at 9.98 s.
 */
const BEAT = 0.5085;
const B0 = 0.32;
const beat = (n: number) => B0 + n * BEAT;
const RACE = beat(8); // 4.39: the race starts on the beat

/** A word that lands on the beat: wide capitals, out of a blur, a little too big, then home. */
function Slam({ word, at, sub, color = C.champagne }: { word: string; at: number; sub?: string; color?: string }) {
  const t = useT();
  const k = pop(t, at, 0.42);
  const e = clamp01((t - at) / 0.22);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 110 }}>
      <AbsoluteFill style={{ background: "linear-gradient(to top, oklch(0.05 0.004 265 / 0.86) 0%, oklch(0.05 0.004 265 / 0.5) 30%, transparent 55%)" }} />
      <div style={{ position: "relative", textAlign: "center" }}>
        <div style={{ fontFamily: F.wide, fontWeight: 600, fontSize: 150, lineHeight: 1, letterSpacing: "0.02em", color, opacity: e, transform: `scale(${1.3 - 0.3 * Math.min(1, k)})`, filter: e < 1 ? `blur(${(1 - e) * 16}px)` : undefined, textShadow: glow(color, 0.9) }}>{word}</div>
        {sub ? <div style={{ fontFamily: F.mono, fontSize: 36, color: C.ink2, marginTop: 22, opacity: clamp01((t - at - 0.15) / 0.3) }}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
}

function AdScene() {
  const t = useT();
  const card = useLine("ad-01", 4, 13.9) - 0.3;
  const tag = useLine("ad-01", 5, 15.2) - card;
  const cut = (n: number) => s(beat(n));
  const underline = clamp01((t - beat(6) - 0.15) / 0.4);
  return (
    <AbsoluteFill style={{ background: C.deep }}>
      {/* 1 · the ticket: nine WMON at a limit, and the tap */}
      <Sequence durationInFrames={cut(2)} name="buy">
        <Shot take="03-buy" from={3.2} pointer moves={[{ at: 3.2, x: 1500, y: 860, zoom: 1.75 }, { at: 3.3, dur: 1.4, x: 1490, y: 900, zoom: 2.05 }]} />
        <Slam word="BUY." at={B0} sub={`9 WMON · limit ≤ $${T.limit}`} />
      </Sequence>
      {/* 2 · its row: sealed, in a block */}
      <Sequence from={cut(2)} durationInFrames={cut(4) - cut(2)} name="sealed">
        <Shot take="03-buy" from={5.25} pointer={false} moves={[{ at: 5.25, x: 520, y: 880, zoom: 2.3 }, { at: 5.3, dur: 1.2, x: 560, y: 885, zoom: 2.5 }]} />
        <Slam word="SEALED." at={0.02} sub={`block ${T.upTo.toLocaleString("en-US")} · ${T.sealedAt} UTC`} color={C.ink} />
      </Sequence>
      {/* 3 · the fill: one price for everyone in the auction */}
      <Sequence from={cut(4)} durationInFrames={cut(6) - cut(4)} name="one price">
        <Shot take="03-buy" from={45.18} pointer={false} moves={[{ at: 45.18, x: 960, y: 190, zoom: 2.0 }, { at: 45.2, dur: 1.4, x: 960, y: 190, zoom: 2.25 }]} />
        <Ring at={0.18} x={960} y={300} size={1300} color={C.buy} width={3} />
        <Slam word="ONE PRICE." at={0.02} sub={`9 WMON at $${T.price}`} color={C.buy} />
      </Sequence>
      {/* 4 · its receipt: Chainlink observed the price after the seal */}
      <Sequence from={cut(6)} durationInFrames={s(RACE) - cut(6)} name="priced after">
        <Shot
          take="05-receipt"
          pointer={false}
          moves={[
            { at: 0, x: 900, y: 505, zoom: 2.1 },
            { at: 0.05, dur: 1.0, x: 980, y: 505, zoom: 2.3 },
          ]}
          over={({ at: point }) => {
            const [x0, y0] = point(1004, 497);
            const [x1] = point(1066, 497);
            return <div style={{ position: "absolute", left: x0, top: y0 + 3, width: (x1 - x0) * underline, height: 5, background: C.accent, boxShadow: glow(C.accent, 0.8) }} />;
          }}
        />
        <Slam word="PRICED AFTER." at={0.02} sub="Chainlink observed it 24 s after the seal" color={C.accent} />
      </Sequence>
      {/* the race, its shutter on the drop (9.98 s) */}
      <Sequence from={s(RACE)} durationInFrames={s(card - RACE)} name="photo finish">
        <PhotoFinish race={[0.12, 5.4]} freeze={9.98 - RACE} />
      </Sequence>
      <Sequence from={s(card)} name="close">
        <Close tagAt={tag} />
      </Sequence>
      {/* a breath of light on each cut of the montage */}
      {[2, 4, 6, 8].map((n) => (
        <Flash key={n} at={beat(n)} peak={0.28} dur={0.2} />
      ))}
      <AbsoluteFill style={{ background: "black", opacity: interpolate(t, [0, 0.12], [1, 0], { extrapolateRight: "clamp" }) }} />
    </AbsoluteFill>
  );
}

export const AD: Beat[] = [
  {
    id: "ad",
    Scene: AdScene,
    seconds: 21,
    // the close sets "Unison. Prices nobody saw first. Live on Monad." in its own type
    voice: [{ id: "ad-01", line: 2, on: 9.9, captions: [0, 1, 2, 3] }],
    sfx: [
      { file: "sfx-tick.mp3", at: beat(0), volume: 0.4 },
      { file: "sfx-seal.mp3", at: beat(2), volume: 0.6 },
      { file: "sfx-chime.mp3", at: beat(4), volume: 0.42 },
      { file: "sfx-pass.mp3", at: beat(6), volume: 0.42 },
      { file: "sfx-whoosh.mp3", at: RACE - 0.25, volume: 0.4 },
      { file: "sfx-shutter.mp3", at: 9.98, volume: 0.65 },
    ],
  },
];

// the drop on the freeze frame; the bell as the end card comes up, the music gone quiet just before it
export const planAd = () =>
  plan(AD, {
    file: "music-demo.mp3",
    drop: { track: MUSIC_DEMO.drop, beat: "ad", at: 9.98 },
    end: { track: MUSIC_DEMO.bell, lead: 1.5, beat: "ad", voice: "ad-01", line: 4, at: -0.05 },
  });

export const Ad = (props: PlanProps) => <Film beats={AD} plan={props} music />;
