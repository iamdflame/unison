import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../../brand";
import { useLine } from "../../kit/Plan";

/**
 * The market (pitch-05), each number with its source on screen (docs/MARKET.md): tokenized stocks at a record
 * $3.8B (Crypto Briefing, 6 October 2026, citing RWA.xyz, Token Terminal and Binance Research); stock perpetuals at
 * $67.8B in June, 16 times tokenized stocks' spot volume (Pantera, State of Tokenization, September 2026).
 */
const PERPS = 67.8;
const SPOT = PERPS / 16;

export const Market = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  // on the words: "…a record…" / "And people want to trade…" / "in June, stock perpetuals…" / "Issuing…" / "Liquid markets…"
  const at = [useLine("pitch-05", 0, 0.4), useLine("pitch-05", 1, 4.6), useLine("pitch-05", 2, 6.4), useLine("pitch-05", 3, 13.4), useLine("pitch-05", 4, 15.0)];
  const ramp = (a: number, b: number) => settle(interpolate(t, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const first = ramp(at[0]! - 0.2, at[0]! + 0.5);
  const cap = ramp(at[0]! - 0.1, at[0]! + 2.2);
  const bars = ramp(at[1]! - 0.3, at[1]! + 0.4);
  // the bars grow as "people want to trade stocks on chain"; 16× lands on "sixteen times"
  const perps = ramp(at[1]! + 0.3, at[1]! + 2.3);
  const spot = ramp(at[1]! + 0.3, at[1]! + 0.9);
  const times = ramp(at[2]! + 1.6, at[2]! + 2.4);
  const verdict = ramp(at[3]! - 0.3, at[3]! + 0.6);
  const solved = ramp(at[3]! - 0.1, at[3]! + 0.7);
  const not = ramp(at[4]! - 0.1, at[4]! + 0.7);
  const W0 = 1040;
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      {/* a record */}
      <div style={{ position: "absolute", left: 160, top: 150, opacity: first * (1 - verdict) }}>
        <div style={{ fontFamily: F.text, fontSize: 24, letterSpacing: "0.16em", color: C.ink2 }}>TOKENIZED STOCKS · A RECORD</div>
        <div style={{ fontFamily: F.display, fontSize: 150, lineHeight: 1.05, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>${(3.8 * cap).toFixed(1)}B</div>
        <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, marginTop: 6 }}>market cap, 6 October 2026 · RWA.xyz, Token Terminal, Binance Research via Crypto Briefing</div>
      </div>

      {/* and where the trading went */}
      <div style={{ position: "absolute", left: 160, top: 520, width: 1600, opacity: bars * (1 - verdict) }}>
        <div style={{ fontFamily: F.text, fontSize: 24, letterSpacing: "0.16em", color: C.ink2 }}>TRADED IN JUNE 2026</div>
        <div style={{ marginTop: 34, display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ width: 360, flexShrink: 0, fontFamily: F.text, fontSize: 30 }}>Stock perpetuals</div>
          <div style={{ height: 54, width: W0 * perps, background: C.accent, borderRadius: 8, boxShadow: `0 0 30px ${C.glow}` }} />
          <div style={{ fontFamily: F.mono, fontSize: 30, opacity: perps }}>${(PERPS * perps).toFixed(1)}B</div>
        </div>
        <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ width: 360, flexShrink: 0, fontFamily: F.text, fontSize: 30 }}>Tokenized stocks, spot</div>
          <div style={{ height: 54, width: ((W0 * SPOT) / PERPS) * spot, background: C.champagne, borderRadius: 8 }} />
          <div style={{ fontFamily: F.mono, fontSize: 30, opacity: spot }}>≈ ${SPOT.toFixed(1)}B</div>
        </div>
        <div style={{ marginTop: 26, display: "flex", alignItems: "baseline", gap: 18, opacity: times }}>
          <div style={{ fontFamily: F.display, fontSize: 84, color: C.accent }}>16×</div>
          <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink2 }}>People want to trade stocks on chain. Mostly, they trade the derivative.</div>
        </div>
        <div style={{ fontFamily: F.text, fontSize: 20, color: C.ink3, marginTop: 10 }}>Perpetuals on Hyperliquid and Lighter · Pantera, State of Tokenization, September 2026</div>
      </div>

      {/* the verdict */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: verdict }}>
        <div style={{ fontFamily: F.display, fontSize: 92, color: C.ink3, opacity: solved }}>Issuing the tokens is solved.</div>
        <div style={{ fontFamily: F.display, fontSize: 92, color: C.ink, marginTop: 24, opacity: not, transform: `translateY(${(1 - not) * 14}px)` }}>Liquid markets for them aren&apos;t.</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
