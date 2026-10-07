import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../../brand";
import { CHALLENGE_URL, SITE } from "../../data/chain";
import { useLine } from "../../kit/Plan";
import { QR } from "../../kit/QR";
import { FOUNDER } from "./Founder";

/**
 * What's next, the ask, and the close (pitch-06): three next steps; the three people it's for; then the founder, the
 * name and the promise, and a way in.
 */
const NEXT = ["An external audit", "More stocks, as Chainlink's feeds arrive", "Market makers running vaults"];
const WHO = ["You make markets", "You issue tokenized stocks", "You think you're fast enough"];

export const Ask = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  const step = (a: number, b = a + 0.7) => settle(interpolate(t, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  // "Next: an audit, more stocks…" / "and market makers…" / "If you make markets, issue…" / "or think you're fast enough," /
  // "come snipe us." / "Unison."
  const at = [useLine("pitch-06", 0, 0.3), useLine("pitch-06", 1, 3.9), useLine("pitch-06", 2, 6.4), useLine("pitch-06", 3, 9.0), useLine("pitch-06", 4, 10.6), useLine("pitch-06", 5, 12.4)];
  const items = [at[0]! + 0.5, at[0]! + 1.6, at[1]!];
  const whoAt = [at[2]!, at[2]! + 1.3, at[3]!];
  const next = 1 - step(at[2]! - 0.6, at[2]! - 0.1);
  const ask = step(at[2]! - 0.3) * (1 - step(at[5]! - 0.4, at[5]! + 0.2));
  const close = step(at[5]! - 0.2, at[5]! + 0.8);
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <div style={{ position: "absolute", left: 160, top: 220, opacity: next }}>
        <div style={{ fontFamily: F.text, fontSize: 24, letterSpacing: "0.16em", color: C.ink2, opacity: step(0.2) }}>NEXT</div>
        {NEXT.map((item, i) => (
          <div key={item} style={{ display: "flex", alignItems: "baseline", gap: 30, marginTop: 44, opacity: step(items[i]!), transform: `translateX(${(1 - step(items[i]!)) * -24}px)` }}>
            <div style={{ fontFamily: F.mono, fontSize: 34, color: C.champagne }}>0{i + 1}</div>
            <div style={{ fontFamily: F.display, fontSize: 80 }}>{item}</div>
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", left: 160, top: 250, opacity: ask }}>
        {WHO.map((who, i) => (
          <div key={who} style={{ fontFamily: F.display, fontSize: 76, marginTop: i ? 20 : 0, color: C.ink2, opacity: step(whoAt[i]!) }}>
            {who}.
          </div>
        ))}
        <div style={{ fontFamily: F.display, fontSize: 120, marginTop: 56, color: C.champagne, opacity: step(at[4]!), transform: `scale(${0.96 + 0.04 * step(at[4]!)})`, transformOrigin: "0 50%" }}>Come snipe us.</div>
      </div>

      <AbsoluteFill style={{ opacity: close }}>
        <div style={{ position: "absolute", left: 160, top: 300 }}>
          <div style={{ fontFamily: F.display, fontSize: 150, letterSpacing: "0.14em" }}>UNISON</div>
          <div style={{ fontFamily: F.display, fontSize: 60, color: C.ink2, marginTop: 8 }}>Prices nobody saw first.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 70 }}>
            <div style={{ width: 120, height: 120, borderRadius: 60, overflow: "hidden", boxShadow: `0 0 0 2px ${C.lineStrong}` }}>
              <Img src={staticFile(FOUNDER.photo)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "51% 31%", transform: "scale(2.6)", transformOrigin: "51% 33%" }} />
            </div>
            <div>
              <div style={{ fontFamily: F.text, fontSize: 32, fontWeight: 600 }}>{FOUNDER.name}</div>
              <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink3, marginTop: 4 }}>{FOUNDER.role}</div>
            </div>
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 28, color: C.ink3, marginTop: 44 }}>{SITE} · live on Monad mainnet</div>
        </div>
        <div style={{ position: "absolute", right: 200, top: 330, textAlign: "center" }}>
          <QR url={CHALLENGE_URL} size={340} fg={C.deep} bg={C.ink} />
          <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, marginTop: 14 }}>{CHALLENGE_URL.replace("https://www.", "")}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
