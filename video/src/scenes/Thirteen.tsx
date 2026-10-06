import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";
import { CAUSAL } from "../data/chain";

/**
 * The thirteen seconds. A timeline from Chainlink's observation to its landing on chain, compressed onto a visible
 * clock. Above it, the market has already moved; a sniper trades against the price still on chain. Then the
 * measurement: how often that gap was worth sniping on MON.
 */
const X0 = 260;
const X1 = 1660;
const Y = 560;
const xAt = (sec: number) => X0 + (sec / 13) * (X1 - X0);

export const Thirteen = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  // 13 seconds of chain time play in 7 seconds of screen time, starting at 1.2 s
  const clock = interpolate(t, [1.2, 8.2], [0, 13], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const enter = settle(interpolate(t, [0, 0.9], [0, 1]));
  const flight = xAt(clock);
  const landed = clock >= 13;
  const sniper = settle(interpolate(clock, [2.2, 3.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const verdict = settle(interpolate(t, [9.2, 10.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const counter = interpolate(t, [10.4, 12.4], [0, CAUSAL.oldRuleGap.perHour], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink, opacity: enter }}>
      {/* the clock */}
      <div style={{ position: "absolute", top: 140, width: "100%", textAlign: "center" }}>
        <div style={{ fontFamily: F.display, fontSize: 150, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>
          {clock.toFixed(1)}
          <span style={{ fontSize: 70, color: C.ink3 }}> s</span>
        </div>
      </div>

      {/* the market lane: the move is visible at once */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <text x={X0} y={Y - 170} fill={C.ink3} style={{ font: `500 22px ${F.text}`, letterSpacing: "0.12em" }}>
          THE MARKET (COINBASE, KRAKEN)
        </text>
        <path
          d={`M${X0},${Y - 90} L${xAt(0.6)},${Y - 92} L${xAt(1.1)},${Y - 128} L${X1},${Y - 130}`}
          stroke={C.champagne}
          strokeWidth={3}
          fill="none"
          strokeDasharray={1800}
          strokeDashoffset={1800 * (1 - Math.min(clock / 13, 1))}
        />
        <text x={X0} y={Y - 26} fill={C.ink3} style={{ font: `500 22px ${F.text}`, letterSpacing: "0.12em" }}>
          THE PRICE ON CHAIN
        </text>
        <line x1={X0} x2={X1} y1={Y} y2={Y} stroke={C.lineStrong} strokeWidth={2} />
        {/* the old price holds on chain until the report lands */}
        <line x1={X0} x2={landed ? X1 : flight} y1={Y} y2={Y} stroke={C.ink2} strokeWidth={4} />
        {Array.from({ length: 14 }, (_, i) => (
          <g key={i}>
            <line x1={xAt(i)} x2={xAt(i)} y1={Y + 14} y2={Y + 26} stroke={C.ink3} strokeWidth={1.5} />
            <text x={xAt(i)} y={Y + 56} textAnchor="middle" fill={C.ink3} style={{ font: `400 20px ${F.mono}` }}>
              {i}
            </text>
          </g>
        ))}
        {/* observed */}
        <circle cx={X0} cy={Y} r={12} fill={C.accent} />
        <circle cx={X0} cy={Y} r={12 + 30 * ((t * 1.2) % 1)} fill="none" stroke={C.accent} opacity={1 - ((t * 1.2) % 1)} />
        <text x={X0} y={Y + 110} textAnchor="middle" fill={C.accent} style={{ font: `600 26px ${F.text}` }}>
          Chainlink observes
        </text>
        {/* the report in flight */}
        {!landed && <circle cx={flight} cy={Y} r={9} fill={C.champagne} />}
        {/* landed: the price on chain finally steps to where the market already was */}
        {landed && (
          <g>
            <line x1={X1} x2={X1} y1={Y} y2={Y - 130} stroke={C.champagne} strokeWidth={4} />
            <circle cx={X1} cy={Y - 130} r={9} fill={C.champagne} />
          </g>
        )}
        {/* landed */}
        <g opacity={landed ? 1 : 0.25}>
          <rect x={X1 - 14} y={Y - 14} width={28} height={28} fill={landed ? C.champagne : "none"} stroke={C.champagne} strokeWidth={2} rx={4} />
          <text x={X1} y={Y + 110} textAnchor="middle" fill={C.champagne} style={{ font: `600 26px ${F.text}` }}>
            lands on chain
          </text>
        </g>
        {/* the sniper, trading against the price on chain */}
        <g opacity={sniper}>
          <line x1={xAt(2.6)} x2={xAt(2.6)} y1={Y - 128} y2={Y} stroke={C.sell} strokeWidth={3} strokeDasharray="6 8" />
          <circle cx={xAt(2.6)} cy={Y - 128} r={10} fill={C.sell} />
          <circle cx={xAt(2.6)} cy={Y} r={10} fill={C.sell} />
          <text x={xAt(2.6) + 22} y={Y - 62} fill={C.sell} style={{ font: `600 26px ${F.text}` }}>
            trades against the old price
          </text>
        </g>
      </svg>

      {/* the measurement */}
      <div style={{ position: "absolute", bottom: 150, width: "100%", textAlign: "center", opacity: verdict }}>
        <div style={{ fontFamily: F.display, fontSize: 92 }}>
          {counter.toFixed(1)} <span style={{ fontFamily: F.text, fontSize: 40, color: C.ink2 }}>times an hour, on MON</span>
        </div>
        <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink3, marginTop: 10 }}>
          {CAUSAL.oldRuleGap.pctOfRounds}% of Chainlink's observations moved more than the vault's {CAUSAL.oldRuleGap.overBps} bp of spread and fee
        </div>
      </div>
    </AbsoluteFill>
  );
};
