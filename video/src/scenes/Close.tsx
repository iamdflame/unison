import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { C, F, settle } from "../brand";
import { CHALLENGE, CHALLENGE_URL, SITE } from "../data/chain";
import { Backdrop, clamp01, Drift, glow, Label, move, pop, Ring, Sweep, useT, Words } from "../kit/Fx";
import { QR } from "../kit/QR";
import { FOUNDER } from "./pitch/Founder";

/**
 * The close, on the bell (0.25 s): the name rings out, letter by letter, then the promise (at `tagAt`, on its words);
 * then everything rises to make room for the dare, the pot it pays, and a way in; with `founder`, who's daring you.
 */
const BELL = 0.25;
const NAME = "UNISON";

export const Close = ({ tagAt = 2.0, founder = false }: { tagAt?: number; founder?: boolean }) => {
  const t = useT();
  const rise = settle(clamp01((t - 4.1) / 0.9));
  const pot = Number.parseFloat(CHALLENGE.pots.causal);
  const counted = Math.round(pot * settle(clamp01((t - 4.6) / 0.9)));
  const bloom = interpolate(t, [BELL, BELL + 0.06, BELL + 1.6], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={50} y={36 - 8 * rise} strength={0.13 + 0.12 * bloom} />
      <Drift to={1.035} over={8}>
        <Ring at={BELL} x={960} y={360 - 150 * rise} size={1400} />
        <Ring at={BELL + 0.18} x={960} y={360 - 150 * rise} size={900} width={1.5} color={C.ink2} />
        {/* the name, then the promise */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 220, textAlign: "center", transform: `translateY(${-150 * rise}px) scale(${1 - 0.18 * rise})`, transformOrigin: "50% 0" }}>
          <div style={{ fontFamily: F.display, fontSize: 230, lineHeight: 1, letterSpacing: `${0.22 + 0.2 * (1 - move(t, BELL, 1.2))}em`, paddingLeft: "0.22em", textShadow: glow(C.champagne, 0.5 + bloom) }}>
            <Sweep at={1.15} dur={1.3}>
              {NAME.split("").map((ch, i) => {
                const e = move(t, BELL + i * 0.06, 0.7);
                return (
                  <span key={i} style={{ display: "inline-block", opacity: e, transform: `translateY(${(1 - e) * 40}px) scale(${1.15 - 0.15 * e})`, filter: e < 1 ? `blur(${(1 - e) * 14}px)` : undefined }}>
                    {ch}
                  </span>
                );
              })}
            </Sweep>
          </div>
          <div style={{ fontFamily: F.displaySmall, fontSize: 78, color: C.ink2, marginTop: 34 }}>
            <Words text="Prices nobody saw first." at={tagAt - 0.1} stagger={0.09} dur={0.7} />
          </div>
        </div>
        {/* the dare, its pot, and the way in */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 560, display: "flex", justifyContent: "center", alignItems: "center", gap: 110, opacity: rise, transform: `translateY(${(1 - rise) * 60}px)` }}>
          <div>
            <Label color={C.champagne} size={34} style={{ letterSpacing: "0.3em" }}>
              Snipe us.
            </Label>
            <div style={{ fontFamily: F.display, fontSize: 70, lineHeight: 1.1, marginTop: 14 }}>
              The pot is still full:
              <br />
              <span style={{ fontSize: 120, color: C.champagne, textShadow: glow(C.champagne, 0.8), display: "inline-block", transform: `scale(${Math.max(0.8, pop(t, 4.6, 0.6))})`, transformOrigin: "0 70%" }}>
                {counted} AUSD
              </span>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 32, color: C.ink2, marginTop: 22 }}>{SITE} · live on Monad mainnet</div>
            {founder ? (
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 30 }}>
                <div style={{ width: 92, height: 92, borderRadius: 46, overflow: "hidden", boxShadow: `0 0 0 2px ${C.champagne}, ${glow(C.champagne, 0.4)}` }}>
                  <Img src={staticFile(FOUNDER.photo)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "51% 31%", transform: "scale(2.6)", transformOrigin: "51% 33%" }} />
                </div>
                <div>
                  <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 32 }}>{FOUNDER.name}</div>
                  <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink2, marginTop: 2 }}>{FOUNDER.role}</div>
                </div>
              </div>
            ) : null}
          </div>
          <div style={{ textAlign: "center", transform: `scale(${Math.max(0.7, pop(t, 4.35, 0.6))})` }}>
            <div style={{ padding: 18, borderRadius: 26, background: C.ink, boxShadow: glow(C.champagne, 0.7) }}>
              <QR url={CHALLENGE_URL} size={300} fg={C.deep} bg={C.ink} />
            </div>
            <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink2, marginTop: 16 }}>{CHALLENGE_URL.replace("https://www.", "")}</div>
          </div>
        </div>
      </Drift>
    </AbsoluteFill>
  );
};
