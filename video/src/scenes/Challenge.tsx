import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";
import { CHALLENGE as K } from "../data/chain";

/**
 * Snipe us. The two pots, and our sniper's score on each, as the contract would judge a claim: live on mainnet,
 * then over a week of real prices. Bars grow from zero; the threshold the pot pays above is drawn as a hairline.
 */
const ZERO = 560;
const SCALE = 9; // px per bp

function Bar({ x, bps, color, label, sub, at, t }: { x: number; bps: number; color: string; label: string; sub: string; at: number; t: number }) {
  const g = settle(interpolate(t, [at, at + 1.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const h = Math.abs(bps) * SCALE * g;
  const up = bps >= 0;
  return (
    <>
      <div style={{ position: "absolute", left: x, top: up ? ZERO - h : ZERO, width: 180, height: h, background: color, borderRadius: up ? "8px 8px 0 0" : "0 0 8px 8px" }} />
      <div style={{ position: "absolute", left: x - 60, width: 300, top: up ? ZERO - h - 84 : ZERO + h + 16, textAlign: "center", opacity: g }}>
        <div style={{ fontFamily: F.display, fontSize: 56, color }}>
          <span style={{ fontFamily: F.text, fontWeight: 600, fontSize: 46, marginRight: 4 }}>{bps > 0 ? "+" : "−"}</span>
          {`${Math.abs(bps * g).toFixed(1)} bp`}
        </div>
      </div>
      <div style={{ position: "absolute", left: x - 70, width: 320, top: 876, textAlign: "center", opacity: g }}>
        <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink, fontWeight: 600 }}>{label}</div>
        <div style={{ fontFamily: F.text, fontSize: 20, color: C.ink3, marginTop: 4 }}>{sub}</div>
      </div>
    </>
  );
}

/**
 * `week`: only the week's replay, its bars landing at `oldAt` and `unisonAt` (seconds): for a film that has just
 * shown the live scores on the page itself.
 */
export const Challenge = ({ week = false, oldAt = 0.8, unisonAt = 1.6 }: { week?: boolean; oldAt?: number; unisonAt?: number }) => {
  const f = useCurrentFrame();
  const t = f / s(1);
  const head = settle(interpolate(t, [0, 0.8], [0, 1]));
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <div style={{ position: "absolute", top: 70, left: 140, opacity: head }}>
        <div style={{ fontFamily: F.display, fontSize: 96 }}>Snipe us.</div>
        <div style={{ fontFamily: F.text, fontSize: 30, color: C.ink2, marginTop: 8, maxWidth: 820 }}>
          A standing pot pays anyone whose fills beat the price by more than {K.terms.epsilonBps} bp over {K.terms.minFills} fills, judged by a contract against Chainlink's own history.
        </div>
      </div>
      <div style={{ position: "absolute", top: 90, right: 140, textAlign: "right", opacity: head }}>
        <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, letterSpacing: "0.12em" }}>THE POTS</div>
        <div style={{ fontFamily: F.display, fontSize: 60, marginTop: 6 }}>{K.pots.causal}</div>
        <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3 }}>on Unison · {K.pots.old} on the old rule</div>
      </div>

      {/* zero, and the line the pot pays above */}
      <div style={{ position: "absolute", left: 140, right: 140, top: ZERO, height: 2, background: C.lineStrong }} />
      <div style={{ position: "absolute", left: 140, right: 140, top: ZERO - K.terms.epsilonBps * SCALE, height: 1, background: C.champagne, opacity: 0.6 }} />
      <div style={{ position: "absolute", right: 140, top: ZERO - K.terms.epsilonBps * SCALE - 30, fontFamily: F.text, fontSize: 18, color: C.champagne }}>
        the pot pays above +{K.terms.epsilonBps} bp
      </div>

      {week ? null : (
        <>
          <Bar x={360} bps={K.live.oldBps} color={C.sell} label="Old rule, live" sub={`${K.live.fills} fills on mainnet`} at={1.0} t={t} />
      <Bar x={640} bps={K.live.causalBps} color={C.accent} label="Unison, live" sub={`${K.live.fills} fills on mainnet`} at={1.5} t={t} />
        </>
      )}
      <Bar x={week ? 620 : 1080} bps={K.replay.oldBps} color={C.sell} label="Old rule, a week" sub={`${K.replay.trades.toLocaleString("en-US")} trades replayed`} at={week ? oldAt : 4.0} t={t} />
      <Bar x={week ? 1120 : 1360} bps={K.replay.causalBps} color={C.accent} label="Unison, a week" sub={`${K.replay.rounds.toLocaleString("en-US")} Chainlink rounds`} at={week ? unisonAt : 4.5} t={t} />
    </AbsoluteFill>
  );
};
