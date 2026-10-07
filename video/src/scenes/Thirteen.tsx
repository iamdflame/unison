import { AbsoluteFill, interpolate } from "remotion";
import { C, F, settle } from "../brand";
import { CAUSAL } from "../data/chain";
import { Backdrop, clamp01, Drift, glow, Label, move, pop, useT } from "../kit/Fx";

/**
 * The thirteen seconds. Chainlink observes a price; the market has already moved; for thirteen seconds the old price
 * is still the one on chain, and that window is what a sniper trades. Drawn large, on a clock: the market's line
 * jumps, the chain's stays put, the window between them fills in garnet until the report lands. Then the
 * measurement: how often that window was worth sniping on MON.
 */
const X0 = 210;
const X1 = 1710;
const YM0 = 560; // the market before its move
const YM1 = 455; // after
const YC = 690; // the price on chain, until the report lands
const xAt = (sec: number) => X0 + (sec / 13) * (X1 - X0);

export const Thirteen = () => {
  const t = useT();
  // 13 seconds of chain time play in 7 seconds of screen time, from 1.2 s
  const clock = interpolate(t, [1.2, 8.2], [0, 13], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const enter = move(t, 0, 0.6);
  const landed = clock >= 13;
  const verdict = settle(clamp01((t - 9.0) / 1.0));
  const counter = interpolate(t, [10.2, 12.2], [0, CAUSAL.oldRuleGap.perHour], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const head = xAt(clock);
  const moved = clamp01((clock - 0.6) / 0.5);
  const yMarket = YM0 + (YM1 - YM0) * settle(moved);
  const land = settle(clamp01((clock - 12.6) / 0.4));
  const sniperAt = 2.6;
  const sniper = clock >= sniperAt ? pop(clock, sniperAt, 1.2) : 0;
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={50} y={20} strength={0.12} fill={C.sell} />
      <Drift to={1.03} over={15}>
        {/* the clock */}
        <div style={{ position: "absolute", left: 80, top: 70 }}>
          <Label color={C.champagne} size={28}>
            The thirteen seconds
          </Label>
        </div>
        <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", transform: `translateY(${-40 * verdict}px) scale(${1 - 0.25 * verdict})`, transformOrigin: "50% 0" }}>
          <div style={{ fontFamily: F.display, fontSize: 230, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: landed ? C.champagne : C.ink, textShadow: glow(landed ? C.champagne : C.ink2, landed ? 0.9 : 0.35) }}>
            {clock.toFixed(1)}
            <span style={{ fontSize: 90, color: C.ink3 }}> s</span>
          </div>
          <div style={{ fontFamily: F.text, fontSize: 32, color: C.ink2, marginTop: 8 }}>from Chainlink seeing a price to that price landing on chain</div>
        </div>

        <AbsoluteFill style={{ opacity: (1 - verdict) * enter, transform: `translateY(${-30 * verdict}px)` }}>
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <defs>
              <linearGradient id="window" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={C.sell} stopOpacity={0.34} />
                <stop offset="1" stopColor={C.sell} stopOpacity={0.12} />
              </linearGradient>
            </defs>
            {/* the window the old price stays on chain, filling as the clock runs */}
            {moved > 0 ? <rect x={xAt(1.1)} y={YM1} width={Math.max(0, Math.min(head, X1) - xAt(1.1)) * (1 - land)} height={YC - YM1} fill="url(#window)" /> : null}
            {/* the market */}
            <path d={`M${X0},${YM0} L${xAt(0.6)},${YM0} L${xAt(1.1)},${yMarket} L${Math.max(xAt(1.1), head)},${yMarket}`} stroke={C.champagne} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ filter: `drop-shadow(0 0 10px ${C.champagne})` }} />
            {/* the price on chain: the old one until the report lands, then where the market already was */}
            <line x1={X0} x2={X1} y1={YC} y2={YC} stroke={C.lineStrong} strokeWidth={3} />
            <line x1={X0} x2={Math.min(head, X1)} y1={YC} y2={YC} stroke={C.ink} strokeWidth={7} strokeLinecap="round" />
            {land > 0 ? <line x1={X1} x2={X1} y1={YC} y2={YC + (YM1 - YC) * land} stroke={C.champagne} strokeWidth={7} strokeLinecap="round" /> : null}
            {/* seconds */}
            {Array.from({ length: 14 }, (_, i) => (
              <g key={i} opacity={clock >= i ? 1 : 0.35}>
                <line x1={xAt(i)} x2={xAt(i)} y1={YC + 22} y2={YC + 38} stroke={C.ink3} strokeWidth={2} />
                <text x={xAt(i)} y={YC + 72} textAnchor="middle" fill={C.ink3} style={{ font: `400 26px ${F.mono}` }}>
                  {i}
                </text>
              </g>
            ))}
            {/* observed, and landed */}
            <circle cx={X0} cy={YC} r={16} fill={C.accent} style={{ filter: `drop-shadow(0 0 12px ${C.accent})` }} />
            <rect x={X1 - 18} y={(landed ? YM1 : YC) - 18} width={36} height={36} rx={6} fill={landed ? C.champagne : "none"} stroke={C.champagne} strokeWidth={3} opacity={landed ? 1 : 0.45} />
            {!landed && clock > 0 ? <circle cx={head} cy={YC} r={13} fill={C.ink} style={{ filter: `drop-shadow(0 0 14px ${C.ink})` }} /> : null}
          </svg>
          {/* the labels, set as type rather than in the drawing */}
          <div style={{ position: "absolute", left: X0, top: yMarket - 66 }}>
            <Label color={C.champagne} size={30}>
              The market · Coinbase, Kraken
            </Label>
          </div>
          <div style={{ position: "absolute", left: X0, top: YC + 96 }}>
            <Label color={C.accent} size={30}>
              Chainlink observes
            </Label>
          </div>
          <div style={{ position: "absolute", right: 1920 - X1 - 18, top: YC + 96, textAlign: "right", opacity: landed ? 1 : 0.45 }}>
            <Label color={C.champagne} size={30}>
              Lands on chain
            </Label>
          </div>
          <div style={{ position: "absolute", left: X0, top: YC - 62, opacity: 1 - moved }}>
            <Label color={C.ink2} size={30}>
              The price on chain
            </Label>
          </div>
          {moved > 0.6 ? (
            <div style={{ position: "absolute", left: xAt(4.4), top: YM1 + 70, opacity: move(clock, 1.6, 1.4) * (1 - land) }}>
              <Label color={C.sell} size={32}>
                The old price, still on chain
              </Label>
            </div>
          ) : null}
          {/* the sniper, trading against it */}
          {sniper > 0 ? (
            <div style={{ position: "absolute", left: xAt(sniperAt) - 30, top: YC - 30, width: 60, height: 60, borderRadius: 30, background: C.sell, boxShadow: glow(C.sell, 1), transform: `scale(${sniper})` }} />
          ) : null}
          {sniper > 0 ? (
            <div style={{ position: "absolute", left: xAt(sniperAt) - 6, top: YC + 96 + 52, opacity: clamp01(sniper), width: 640 }}>
              <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 34, color: C.sell }}>A sniper trades against it</div>
            </div>
          ) : null}
        </AbsoluteFill>

        {/* the measurement */}
        {verdict > 0 ? (
          <div style={{ position: "absolute", left: 0, right: 0, top: 380, textAlign: "center", opacity: verdict, transform: `translateY(${(1 - verdict) * 40}px)` }}>
            <div style={{ fontFamily: F.display, fontSize: 250, lineHeight: 1, color: C.champagne, textShadow: glow(C.champagne, 1.1) }}>
              {counter.toFixed(1)}
              <span style={{ fontSize: 150 }}>×</span>
            </div>
            <div style={{ fontFamily: F.display, fontSize: 64, color: C.ink, marginTop: 14 }}>an hour on MON, the old price was worth sniping</div>
            <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink3, marginTop: 18 }}>
              {CAUSAL.oldRuleGap.pctOfRounds}% of Chainlink's observations moved more than the vault's {CAUSAL.oldRuleGap.overBps} bp of spread and fee
            </div>
          </div>
        ) : null}
      </Drift>
    </AbsoluteFill>
  );
};
