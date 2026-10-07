import { AbsoluteFill } from "remotion";
import { C, F, settle } from "../brand";
import { CHALLENGE as K } from "../data/chain";
import { Backdrop, clamp01, Drift, glow, Label, move, useT } from "../kit/Fx";

/**
 * Snipe us. The pots, and our sniper's score as the contract would judge a claim: live on mainnet, then over a week
 * of real prices. The bars drop from zero, large; the line the pot pays above is drawn across them.
 */
const ZERO = 600;
const SCALE = 13; // px per bp

function Bar({ x, w = 330, bps, color, label, sub, at, t }: { x: number; w?: number; bps: number; color: string; label: string; sub: string; at: number; t: number }) {
  const g = settle(clamp01((t - at) / 1.1));
  const h = Math.abs(bps) * SCALE * g;
  const up = bps >= 0;
  return (
    <>
      <div style={{ position: "absolute", left: x, top: up ? ZERO - h : ZERO, width: w, height: h, borderRadius: up ? "16px 16px 0 0" : "0 0 16px 16px", background: `linear-gradient(${up ? "0deg" : "180deg"}, color-mix(in oklch, ${color} 55%, ${C.deep}), ${color})`, boxShadow: glow(color, 0.5 * g) }} />
      {/* the value beside its bar, clear of the header above and the captions below */}
      <div style={up ? { position: "absolute", left: x - 200, width: w + 400, top: ZERO - h - 136, textAlign: "center", whiteSpace: "nowrap", opacity: g } : { position: "absolute", left: x + w + 34, top: ZERO + h / 2 - 66, whiteSpace: "nowrap", opacity: g }}>
        <div style={{ fontFamily: F.display, fontSize: 116, lineHeight: 1, color, textShadow: glow(color, 0.7) }}>
          {bps > 0 ? "+" : "−"}
          {`${Math.abs(bps * g).toFixed(1)} bp`}
        </div>
      </div>
      <div style={{ position: "absolute", left: x - 120, width: w + 240, top: up ? ZERO + 26 : ZERO - 128, textAlign: "center", opacity: g }}>
        <Label color={C.ink} size={28}>
          {label}
        </Label>
        <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink2, marginTop: 6 }}>{sub}</div>
      </div>
    </>
  );
}

/**
 * `week`: only the week's replay, its bars landing at `oldAt` and `unisonAt` (seconds): for a film that has just
 * shown the live scores on the page itself.
 */
export const Challenge = ({ week = false, oldAt = 0.8, unisonAt = 1.6 }: { week?: boolean; oldAt?: number; unisonAt?: number }) => {
  const t = useT();
  const head = move(t, 0, 0.7);
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={50} y={16} strength={0.1} fill={C.sell} />
      <Drift to={1.03} over={10}>
        <div style={{ position: "absolute", top: 64, left: 110, opacity: head }}>
          <Label color={C.champagne} size={30}>
            {week ? "A week of real prices, replayed" : "Snipe us · the standing challenge, and a week replayed"}
          </Label>
          <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink2, marginTop: 12, maxWidth: 900 }}>
            {K.replay.trades.toLocaleString("en-US")} Coinbase trades and {K.replay.rounds.toLocaleString("en-US")} Chainlink rounds, our sniper on each rule, each fill marked {K.terms.horizonSec} s later
          </div>
        </div>
        <div style={{ position: "absolute", top: 60, right: 110, textAlign: "right", opacity: head }}>
          <Label color={C.ink3} size={26}>
            The pot
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 96, lineHeight: 1, color: C.champagne, textShadow: glow(C.champagne, 0.6), marginTop: 6 }}>{K.pots.causal}</div>
          <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink2, marginTop: 6 }}>pays above +{K.terms.epsilonBps} bp over {K.terms.minFills} fills</div>
        </div>

        {/* zero, and the line the pot pays above */}
        <div style={{ position: "absolute", left: 110, right: 110, top: ZERO - 1, height: 3, background: C.lineStrong }} />
        <div style={{ position: "absolute", left: 110, right: 110, top: ZERO - K.terms.epsilonBps * SCALE - 1, height: 2, backgroundImage: `linear-gradient(90deg, ${C.champagne} 50%, transparent 50%)`, backgroundSize: "24px 2px", opacity: 0.8 }} />
        <div style={{ position: "absolute", right: 110, top: ZERO - K.terms.epsilonBps * SCALE - 40, fontFamily: F.text, fontWeight: 600, fontSize: 24, color: C.champagne }}>the pot pays above +{K.terms.epsilonBps} bp</div>

        {/* without the live page before it, the live score sits with the week's */}
        {week ? null : (
          <div style={{ position: "absolute", left: 110, top: 880, display: "flex", gap: 40, alignItems: "baseline", opacity: move(t, 0.4, 0.6) }}>
            <Label color={C.buy} size={26}>
              ● Live on mainnet · {K.live.fills} fills each
            </Label>
            <div style={{ fontFamily: F.display, fontSize: 52, color: C.sell }}>+{K.live.oldBps.toFixed(2)} bp</div>
            <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink2 }}>on the old rule</div>
            <div style={{ fontFamily: F.display, fontSize: 52, color: C.accent }}>−{Math.abs(K.live.causalBps).toFixed(2)} bp</div>
            <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink2 }}>on Unison</div>
          </div>
        )}
        <Bar x={330} bps={K.replay.oldBps} color={C.sell} label="Old rule · it wins" sub={`${K.replay.oldWinsPct}% of its fills won`} at={oldAt} t={t} />
        <Bar x={1000} bps={K.replay.causalBps} color={C.accent} label="Unison · it loses" sub={`${K.replay.causalWinsPct}% of its fills won`} at={unisonAt} t={t} />
      </Drift>
    </AbsoluteFill>
  );
};

