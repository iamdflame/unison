import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";
import { CHALLENGE, CHALLENGE_URL, SITE } from "../data/chain";
import { QR } from "../kit/QR";

/** The close: the name, the promise, the dare, and a way in. */
export const Close = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  const a = settle(interpolate(t, [0.2, 1.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const b = settle(interpolate(t, [2.2, 3.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const c = settle(interpolate(t, [4.4, 5.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <AbsoluteFill style={{ background: C.deep, color: C.ink }}>
      <div style={{ position: "absolute", left: 160, top: 300, opacity: a, transform: `translateY(${(1 - a) * 20}px)` }}>
        <div style={{ fontFamily: F.display, fontSize: 150, letterSpacing: "0.14em" }}>UNISON</div>
        <div style={{ fontFamily: F.display, fontSize: 62, color: C.ink2, marginTop: 10, opacity: b }}>Prices nobody saw first.</div>
        <div style={{ fontFamily: F.text, fontSize: 36, marginTop: 70, opacity: c }}>
          Snipe us. The pot is still full: <span style={{ color: C.champagne }}>{CHALLENGE.pots.causal}</span>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 30, color: C.ink3, marginTop: 18, opacity: c }}>{SITE} · live on Monad</div>
      </div>
      <div style={{ position: "absolute", right: 200, top: 330, opacity: c, textAlign: "center" }}>
        <QR url={CHALLENGE_URL} size={340} fg={C.deep} bg={C.ink} />
        <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, marginTop: 14 }}>{CHALLENGE_URL.replace("https://www.", "")}</div>
      </div>
    </AbsoluteFill>
  );
};
