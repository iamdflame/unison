import { AbsoluteFill, Sequence } from "remotion";
import { C, F, s } from "../../brand";
import { Backdrop, Drift, Flash, glow, Label, move, pop, Sweep, useT, Words } from "../../kit/Fx";
import { useLine } from "../../kit/Plan";
import { Close } from "../Close";

/**
 * What's next, the ask, and the close (pitch-06). The music drops as it begins: "NEXT" lands on it, then the three
 * next steps; then who it's for, in the voice's own words, and the dare; then the close on the bell, with the
 * founder. The narration is set in the scene's own type (the beat runs without captions).
 */
const NEXT = ["An external audit", "More stocks, as Chainlink's feeds arrive", "Market makers running vaults"];

export const Ask = () => {
  const t = useT();
  // "Next: an audit, more stocks…" / "and market makers…" / "If you make markets, issue…" / "or think you're fast enough…" /
  // "come snipe us." / "Unison." / "Prices nobody saw first."
  const at = [0.44, 4.5, 7.15, 9.57, 11.51, 12.74, 13.68].map((d, i) => useLine("pitch-06", i, d));
  const items = [at[0]! + 0.55, at[0]! + 1.65, at[1]!];
  // the close's own bell is 0.25 s in: it rings with the music's, on "Unison."
  const closeAt = at[5]! - 0.2 - 0.25;
  const next = 1 - move(t, at[2]! - 0.45, 0.4);
  const ask = move(t, at[2]! - 0.25, 0.4) * (1 - move(t, closeAt - 0.1, 0.35));
  const half = at[2]! + (at[3]! - at[2]!) * 0.45;
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={28} y={30} strength={0.12} />
      <Sequence durationInFrames={s(closeAt + 0.5)} name="next, and the ask">
        <Drift to={1.035} over={12}>
          {/* what's next, on the drop */}
          <div style={{ position: "absolute", left: 120, top: 110, opacity: next }}>
            <div style={{ fontFamily: F.wide, fontWeight: 600, fontSize: 150, lineHeight: 1, color: C.champagne, textShadow: glow(C.champagne, 0.9), transform: `scale(${Math.max(0.5, pop(t, 0.04, 0.45))})`, transformOrigin: "0 50%" }}>NEXT</div>
            {NEXT.map((item, i) => {
              const e = move(t, items[i]!, 0.55);
              return (
                <div key={item} style={{ display: "flex", alignItems: "baseline", gap: 36, marginTop: 46, opacity: e, transform: `translateX(${(1 - e) * -40}px)` }}>
                  <div style={{ fontFamily: F.mono, fontSize: 44, color: C.champagne }}>0{i + 1}</div>
                  <div style={{ fontFamily: F.display, fontSize: 96, lineHeight: 1 }}>{item}</div>
                </div>
              );
            })}
          </div>
          {/* who it's for, and the dare */}
          <div style={{ position: "absolute", left: 120, top: 150, opacity: ask }}>
            <Label color={C.ink3} size={28}>
              Unison is for you
            </Label>
            <div style={{ fontFamily: F.display, fontSize: 96, lineHeight: 1.18, color: C.ink2, marginTop: 24 }}>
              <div>
                <Words text="If you make markets," at={at[2]!} stagger={0.08} dur={0.5} />
              </div>
              <div>
                <Words text="issue tokenized stocks," at={half} stagger={0.08} dur={0.5} />
              </div>
              <div>
                <Words text="or think you're fast enough…" at={at[3]!} stagger={0.08} dur={0.5} />
              </div>
            </div>
            <div style={{ fontFamily: F.display, fontSize: 176, lineHeight: 1.05, marginTop: 34, color: C.champagne, textShadow: glow(C.champagne, 1), transform: `scale(${Math.max(0.6, pop(t, at[4]!, 0.55))})`, transformOrigin: "0 60%" }}>
              <Sweep at={at[4]! + 0.5}>Come snipe us.</Sweep>
            </div>
          </div>
        </Drift>
        <Flash at={0} peak={0.45} dur={0.4} color="oklch(0.95 0.04 85)" />
      </Sequence>
      <Sequence from={s(closeAt)} name="close">
        <Close founder tagAt={at[6]! - closeAt} />
      </Sequence>
    </AbsoluteFill>
  );
};
