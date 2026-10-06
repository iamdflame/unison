import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";

/**
 * The flip. Orders arrive in a block and are sealed before any price exists. Then Chainlink's next observation
 * arrives, and one price strikes through every order at once. No amounts: this is the rule, not a trade.
 */
const ORDERS = [
  { side: "Buy", color: C.buy, y: 360 },
  { side: "Sell", color: C.sell, y: 500 },
  { side: "Buy", color: C.buy, y: 640 },
];

export const Idea = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  const seal = settle(interpolate(t, [2.4, 3.0], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const sealPress = interpolate(t, [2.4, 2.6, 2.8], [1.4, 0.94, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const obs = settle(interpolate(t, [5.2, 6.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const strike = settle(interpolate(t, [6.6, 7.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const fill = interpolate(t, [7.4, 7.9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const coda = settle(interpolate(t, [9.2, 10.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      {/* the block */}
      <div style={{ position: "absolute", left: 300, top: 280, width: 620, height: 520, borderRadius: 28, border: `2px solid ${C.lineStrong}` }} />
      <div style={{ position: "absolute", left: 330, top: 236, fontFamily: F.mono, fontSize: 24, color: C.ink3 }}>one Monad block · 300 ms</div>
      {ORDERS.map((o, i) => {
        const inT = settle(interpolate(t, [0.3 + i * 0.45, 1.1 + i * 0.45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 360,
              top: o.y,
              width: 500,
              height: 96,
              borderRadius: 18,
              background: interpolate(fill, [0, 1], [0, 1]) > 0.5 ? `color-mix(in oklch, ${o.color} 22%, ${C.raised})` : C.raised,
              boxShadow: `0 0 0 1px ${C.line}`,
              opacity: inT,
              transform: `translateX(${(1 - inT) * -120}px)`,
              display: "flex",
              alignItems: "center",
              padding: "0 32px",
              gap: 22,
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: 7, background: o.color }} />
            <div style={{ fontFamily: F.text, fontSize: 36, fontWeight: 600 }}>{o.side}</div>
            <div style={{ marginLeft: "auto", fontFamily: F.mono, fontSize: 26, color: fill > 0.5 ? o.color : C.ink3 }}>
              {fill > 0.5 ? "filled" : seal > 0.5 ? "sealed" : "…"}
            </div>
          </div>
        );
      })}

      {/* the seal */}
      <div
        style={{
          position: "absolute",
          left: 820,
          top: 230,
          width: 150,
          height: 150,
          borderRadius: 75,
          background: `radial-gradient(circle at 40% 35%, ${C.jewel}, oklch(0.4 0.12 20))`,
          boxShadow: "0 12px 30px rgba(0,0,0,0.6)",
          opacity: seal,
          transform: `scale(${sealPress}) rotate(-8deg)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: F.display,
          fontSize: 34,
          color: "oklch(0.92 0.03 30)",
          letterSpacing: "0.1em",
        }}
      >
        SEALED
      </div>

      {/* the price that doesn't exist yet */}
      <div style={{ position: "absolute", left: 1090, top: 330, width: 560 }}>
        <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink3, letterSpacing: "0.12em" }}>THE PRICE</div>
        <div style={{ fontFamily: F.display, fontSize: 96, marginTop: 10, color: obs > 0.5 ? C.ink : C.ink3 }}>{obs > 0.5 ? "observed" : "not yet"}</div>
        <div style={{ fontFamily: F.text, fontSize: 30, color: C.ink2, marginTop: 14, opacity: seal, maxWidth: 520 }}>
          It is set by Chainlink's next observation, made after the seal.
        </div>
        {/* the observation arrives */}
        <div style={{ marginTop: 50, display: "flex", alignItems: "center", gap: 18, opacity: obs }}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: C.accent, boxShadow: `0 0 0 ${16 * obs}px ${C.glow}` }} />
          <div style={{ fontFamily: F.text, fontSize: 32, color: C.accent, fontWeight: 600 }}>Chainlink observes</div>
        </div>
      </div>

      {/* one price, through every order */}
      <div
        style={{
          position: "absolute",
          left: 300,
          top: 548,
          height: 4,
          width: 620 * strike,
          background: C.accent,
          boxShadow: `0 0 24px ${C.glow}`,
        }}
      />
      <div style={{ position: "absolute", left: 300, width: 620, top: 826, textAlign: "center", fontFamily: F.text, fontSize: 32, fontWeight: 600, color: C.accent, opacity: strike }}>
        one price, for every order in the auction
      </div>

      <div style={{ position: "absolute", bottom: 130, width: "100%", textAlign: "center", fontFamily: F.display, fontSize: 84, opacity: coda }}>
        Nothing to snipe.
      </div>
    </AbsoluteFill>
  );
};
