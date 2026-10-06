import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";
import { PHOTO_FINISH as P } from "../data/chain";

/**
 * The photo finish, from mainnet on 6 October 2026: our own sniper sold the same 3 WMON under both rules. The old
 * rule filled it two seconds after the seal, off a round observed before the move. Unison waited for Chainlink's
 * next observation. Shot like a race broadcast: two lanes, a race clock, then a freeze frame and the two prices.
 */
const T0 = 13 * 3600 + 57 * 60 + 54; // 13:57:54
const T1 = 13 * 3600 + 58 * 60 + 17; // 13:58:17
const sec = (hms: string) => {
  const [h, m, x] = hms.split(":").map(Number);
  return h! * 3600 + m! * 60 + x!;
};
const clock = (t: number) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const x = Math.floor(t % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};
const LX0 = 220;
const LX1 = 1700;
const lx = (t: number) => LX0 + ((t - T0) / (T1 - T0)) * (LX1 - LX0);

function Event({ at, now, y, color, label, sub, above, right }: { at: string; now: number; y: number; color: string; label: string; sub?: string; above?: boolean; right?: boolean }) {
  const show = settle(interpolate(now, [sec(at), sec(at) + 0.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const x = lx(sec(at));
  return (
    <>
      <div style={{ position: "absolute", left: x - 9, top: y - 9, width: 18, height: 18, borderRadius: 9, background: color, opacity: show, boxShadow: `0 0 0 ${8 * show}px color-mix(in oklch, ${color} 25%, transparent)` }} />
      <div
        style={{
          position: "absolute",
          top: above ? y - 118 : y + 26,
          ...(right ? { right: 1920 - x - 10, textAlign: "right" as const } : { left: x - 10 }),
          width: 460,
          fontFamily: F.text,
          fontSize: 24,
          color,
          opacity: show,
        }}
      >
        <div style={{ fontWeight: 600 }}>{label}</div>
        {sub ? <div style={{ color: C.ink3, fontSize: 20, marginTop: 4 }}>{sub}</div> : null}
        <div style={{ fontFamily: F.mono, fontSize: 18, color: C.ink3, marginTop: 4 }}>{at} UTC</div>
      </div>
    </>
  );
}

export const PhotoFinish = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  // 23 seconds of mainnet play in 9 seconds, then the freeze frame
  const now = interpolate(t, [0.8, 9.8], [T0, T1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const flash = interpolate(t, [9.98, 10.0, 10.3], [0, 0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const card = settle(interpolate(t, [10.3, 11.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const lanes = 1 - 0.95 * card;
  const lane = (y: number, title: string, color: string) => (
    <>
      <div style={{ position: "absolute", left: LX0, top: y - 170, fontFamily: F.text, fontSize: 24, letterSpacing: "0.14em", color }}>{title}</div>
      <div style={{ position: "absolute", left: LX0, top: y - 1, width: LX1 - LX0, height: 2, background: C.lineStrong }} />
      <div style={{ position: "absolute", left: LX0, top: y - 2, width: Math.max(0, lx(now) - LX0), height: 4, background: color, opacity: 0.6 }} />
    </>
  );
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <div style={{ position: "absolute", top: 54, left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "0 220px", opacity: lanes }}>
        <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink2 }}>
          Our sniper sells {P.quantity} under both rules · {P.pair} · {P.date}
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 44, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{clock(now)} UTC</div>
      </div>

      <AbsoluteFill style={{ opacity: lanes }}>
        {lane(390, "THE OLD RULE · priced when the auction clears", C.sell)}
        {lane(790, "UNISON · priced at the first observation after the seal", C.accent)}
        <Event at="13:57:56" now={now} y={390} color={C.ink2} label="sells" above />
        <Event at={P.oldRule.filledAt} now={now} y={390} color={C.sell} label={`filled at $${P.oldRule.price}`} sub={`off a round observed before the move ($${P.oldRule.staleRound})`} />
        <Event at={P.unison.sealedAt} now={now} y={790} color={C.ink2} label="sealed" sub={`block ${P.unison.upTo.toLocaleString("en-US")}`} above />
        <Event at={P.unison.observedAt} now={now} y={790} color={C.accent} label={`Chainlink observes $${P.unison.reference}`} sub="6 s after the seal" />
        <Event at={P.unison.clearedAt} now={now} y={790} color={C.buy} label={`cleared at $${P.unison.price}`} right />
      </AbsoluteFill>

      {/* the freeze frame */}
      <AbsoluteFill style={{ background: "white", opacity: flash }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: card }}>
        <div style={{ display: "flex", gap: 120, alignItems: "flex-end", transform: `scale(${0.96 + 0.04 * card})` }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: F.text, fontSize: 26, letterSpacing: "0.14em", color: C.sell }}>THE OLD RULE PAID</div>
            <div style={{ fontFamily: F.display, fontSize: 120, marginTop: 10 }}>${P.oldRule.price}</div>
            <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink3 }}>a price from before the move</div>
          </div>
          <div style={{ textAlign: "center", paddingBottom: 46 }}>
            <div style={{ fontFamily: F.display, fontSize: 84, color: C.champagne }}>{P.gapBps} bp</div>
            <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3 }}>apart</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: F.text, fontSize: 26, letterSpacing: "0.14em", color: C.accent }}>UNISON PAID</div>
            <div style={{ fontFamily: F.display, fontSize: 120, marginTop: 10 }}>${P.unison.price}</div>
            <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink3 }}>the price observed after the seal</div>
          </div>
        </div>
        <div style={{ fontFamily: F.text, fontSize: 30, color: C.ink2, marginTop: 70 }}>The same 3 WMON. The old rule paid the sniper {P.gapBps} bp more.</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
