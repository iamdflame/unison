import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../../brand";
import { FILM_TRADE } from "../../data/chain";
import { useLine } from "../../kit/Plan";
import { Shot } from "../../kit/Screen";
import { Challenge } from "../Challenge";
import { PhotoFinish } from "../PhotoFinish";

/**
 * The proof (pitch-04), three shots the demo already earned: the film's own trade filling on mainnet, the photo
 * finish's verdict (40 bp on the same trade), and the standing challenge, where our sniper wins on the old rule and
 * loses on Unison's.
 */
export const PROOF_SECONDS = 21;

export const Proof = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  // cut on the words: "On the same trade…" to the photo finish, "Our own sniper…" to the challenge
  const finish = useLine("pitch-04", 1, 4.5) - 0.3;
  const board = useLine("pitch-04", 2, 11.5) - 0.3;
  // "It wins on the old one…" / "and loses on ours."
  const wins = useLine("pitch-04", 3, 13.0) - board;
  const loses = useLine("pitch-04", 4, 14.6) - board;
  const label = settle(interpolate(t, [0.4, 1.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) * interpolate(t, [finish - 0.5, finish - 0.1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence durationInFrames={s(finish)} name="live">
        <Shot
          take="03-buy"
          from={44.2}
          hold={0.6}
          pointer={false}
          moves={[
            // the toast as it turns "Bought" (45.36 s of the 4K take)
            { at: 44.2, x: 960, y: 200, zoom: 1.5 },
            { at: 44.4, dur: 3.5, x: 960, y: 180, zoom: 1.7 },
          ]}
        />
        <div style={{ position: "absolute", left: 80, bottom: 80, opacity: label, background: "oklch(0.1 0.006 265 / 0.8)", backdropFilter: "blur(12px)", border: `1px solid ${C.lineStrong}`, borderRadius: 16, padding: "18px 26px" }}>
          <div style={{ fontFamily: F.text, fontSize: 20, letterSpacing: "0.16em", color: C.ink2 }}>LIVE ON MONAD MAINNET</div>
          <div style={{ fontFamily: F.mono, fontSize: 24, color: C.ink, marginTop: 6 }}>auction {FILM_TRADE.upTo.toLocaleString("en-US")} · 7 Oct 2026</div>
        </div>
      </Sequence>
      {/* the photo finish from its last laps: the freeze and the two prices */}
      <Sequence from={s(finish)} durationInFrames={s(board - finish)} name="photo finish">
        <Sequence from={-s(8.6)}>
          <PhotoFinish />
        </Sequence>
      </Sequence>
      <Sequence from={s(board)} name="challenge">
        <Challenge oldAt={wins + 0.15} unisonAt={loses + 0.15} />
      </Sequence>
    </AbsoluteFill>
  );
};
