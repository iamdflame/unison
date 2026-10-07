import { AbsoluteFill } from "remotion";
import { C, F, settle } from "../../brand";
import script from "../../data/script.json";
import { Backdrop, clamp01, Drift, glow, Label, move, Narration, pop, Sweep, useT, Words } from "../../kit/Fx";
import { useLine } from "../../kit/Plan";

/**
 * The market (pitch-05), each number with its source on screen (docs/MARKET.md): tokenized stocks at a record
 * $3.8B (Crypto Briefing, 6 October 2026, citing RWA.xyz, Token Terminal and Binance Research); stock perpetuals at
 * $67.8B in June, 16 times tokenized stocks' spot volume (Pantera, State of Tokenization, September 2026). The
 * narration is set in the scene's own type (the beat runs without captions).
 */
const PERPS = 67.8;
const SPOT = PERPS / 16;
const W0 = 1180;

export const Market = () => {
  const t = useT();
  // "…a record…" / "And people want to trade…" / "in June, stock perpetuals…" / "Issuing…" / "Liquid markets…"
  const at = [0.4, 4.6, 6.4, 13.4, 15.0].map((d, i) => useLine("pitch-05", i, d));
  const first = move(t, at[0]! - 0.2, 0.6);
  const count = settle(clamp01((t - at[0]! - 0.1) / 2.0));
  const bars = move(t, at[1]! - 0.3, 0.6);
  const perps = settle(clamp01((t - at[1]! - 0.3) / 2.0));
  const spot = settle(clamp01((t - at[1]! - 0.3) / 0.6));
  const times = at[2]! + 1.7;
  const verdict = move(t, at[3]! - 0.35, 0.7);
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={verdict > 0.5 ? C.ink2 : C.accent} x={30} y={30} strength={0.1} />
      <Drift to={1.03} over={17}>
        <AbsoluteFill style={{ opacity: 1 - verdict, transform: `translateY(${-50 * verdict}px)` }}>
          {/* a record */}
          <div style={{ position: "absolute", left: 120, top: 70, opacity: first }}>
            <Label color={C.champagne} size={28}>
              Tokenized stocks · a record
            </Label>
            <div style={{ fontFamily: F.display, fontSize: 250, lineHeight: 1, marginTop: 10, color: C.champagne, textShadow: glow(C.champagne, 0.8), fontVariantNumeric: "tabular-nums" }}>${(3.8 * count).toFixed(1)}B</div>
            <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, marginTop: 8 }}>market cap, 6 October 2026 · RWA.xyz, Token Terminal, Binance Research via Crypto Briefing</div>
          </div>
          {/* and where the trading went */}
          <div style={{ position: "absolute", left: 120, top: 470, width: 1680, opacity: bars }}>
            <Label color={C.ink2} size={26}>
              Traded in June 2026
            </Label>
            <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 30 }}>
              <div style={{ width: 300, flex: "none", fontFamily: F.text, fontWeight: 600, fontSize: 34 }}>Stock perpetuals</div>
              <div style={{ height: 96, width: W0 * perps, borderRadius: 14, background: `linear-gradient(90deg, color-mix(in oklch, ${C.accent} 60%, ${C.deep}), ${C.accent})`, boxShadow: glow(C.accent, 0.7) }} />
              <div style={{ fontFamily: F.display, fontSize: 64, opacity: perps }}>${(PERPS * perps).toFixed(1)}B</div>
            </div>
            <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 30 }}>
              <div style={{ width: 300, flex: "none", fontFamily: F.text, fontWeight: 600, fontSize: 34 }}>Tokenized stocks, spot</div>
              <div style={{ height: 96, width: ((W0 * SPOT) / PERPS) * spot, borderRadius: 14, background: C.champagne, boxShadow: glow(C.champagne, 0.5) }} />
              <div style={{ fontFamily: F.display, fontSize: 64, opacity: spot }}>≈ ${SPOT.toFixed(1)}B</div>
            </div>
            <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, marginTop: 18 }}>Perpetuals on Hyperliquid and Lighter · Pantera, State of Tokenization, September 2026</div>
          </div>
          {/* sixteen times */}
          {t > times ? (
            <div style={{ position: "absolute", right: 120, top: 90, textAlign: "right", transform: `scale(${Math.max(0.6, pop(t, times, 0.6))})`, transformOrigin: "100% 0" }}>
              <div style={{ fontFamily: F.display, fontSize: 260, lineHeight: 1, color: C.accent, textShadow: glow(C.accent, 1) }}>16×</div>
              <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 30, color: C.ink2 }}>the derivative, not the token</div>
            </div>
          ) : null}
        </AbsoluteFill>

        {/* the verdict */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: verdict }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: F.display, fontSize: 96, color: C.ink3 }}>
              <Words text="Issuing the tokens is solved." at={at[3]!} stagger={0.09} dur={0.6} />
            </div>
            <div style={{ fontFamily: F.display, fontSize: 116, color: C.ink, marginTop: 30, textShadow: glow(C.ink2, 0.5) }}>
              <Sweep at={at[4]! + 1.0} dur={1.3}>
                <Words text="Liquid markets for them aren't." at={at[4]!} stagger={0.09} dur={0.6} />
              </Sweep>
            </div>
          </div>
        </AbsoluteFill>
        <Narration lines={script["pitch-05"].slice(0, 3).map((l, i) => ({ text: l.text, at: at[i]!, until: i < 2 ? at[i + 1]! - 0.1 : at[3]! - 0.4 }))} accent={{ record: C.champagne, sixteen: C.accent, times: C.accent }} bottom={56} size={52} />
      </Drift>
    </AbsoluteFill>
  );
};
