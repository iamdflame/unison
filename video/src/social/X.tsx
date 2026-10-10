import type { ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C, F } from "../brand";
import { CHALLENGE, PHOTO_FINISH } from "../data/chain";
import rounds from "../data/mon-rounds.json";
import { glow } from "../kit/Fx";
import { Grain } from "../kit/Grain";

/**
 * The X account's look (@unison_fi): its avatar, its header, and the cards its first posts carry. X shows the avatar
 * as a circle (400 × 400) and crops the header (1500 × 500) on phones by about 60 px top and bottom, with the avatar
 * over its lower left, so everything that matters sits in the central band. Every number is the films' own (src/data).
 */

function Ground({ light = C.champagne, x = 50, y = 40, strength = 0.18, children }: { light?: string; x?: number; y?: number; strength?: number; children?: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: C.deep, overflow: "hidden", color: C.ink }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 75% at ${x}% ${y}%, color-mix(in oklch, ${light} ${Math.round(strength * 100)}%, transparent), transparent 72%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 50% 60% at ${100 - x}% ${100 - y}%, color-mix(in oklch, ${C.accent} 8%, transparent), transparent 70%)` }} />
      {children}
      <Grain opacity={0.045} />
    </AbsoluteFill>
  );
}

// the feed's heartbeat: the last 20 rounds of Chainlink's MON/USD on Monad, as the CRE film draws them
const R = rounds.rounds.slice(-20);
function heartbeat(x0: number, x1: number, base: number, spike: number) {
  const t0 = R[0]!.observedAt - 20;
  const t1 = R.at(-1)!.landedAt + 20;
  const lo = Math.min(...R.map((r) => r.price));
  const hi = Math.max(...R.map((r) => r.price));
  const x = (sec: number) => x0 + ((sec - t0) / (t1 - t0)) * (x1 - x0);
  const y = (p: number) => base + spike * 0.18 - ((p - lo) / (hi - lo)) * spike * 0.36;
  let level = y(R[0]!.price);
  let d = `M${x0},${level.toFixed(1)}`;
  for (const r of R) {
    const xo = x(r.observedAt);
    const next = y(r.price);
    for (const [px, py] of [[xo - 8, level], [xo - 5.5, level - spike * 0.04], [xo - 3.5, level], [xo - 1.6, level + spike * 0.05], [xo, level - spike], [xo + 2.4, next + spike * 0.3], [xo + 5, next]] as const) d += ` L${px.toFixed(1)},${py.toFixed(1)}`;
    level = next;
  }
  return `${d} L${x1},${level.toFixed(1)}`;
}

/** The avatar: the mark alone, inside a seal's ring, read at 48 px in a circle. */
export const XAvatar = () => (
  <AbsoluteFill style={{ background: C.deep, overflow: "hidden" }}>
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 44%, color-mix(in oklch, ${C.champagne} 16%, transparent), transparent 62%)` }} />
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 82%, color-mix(in oklch, ${C.accent} 14%, transparent), transparent 40%)` }} />
    {/* the seal's ring, inside X's circle */}
    <div style={{ position: "absolute", left: 80, top: 80, width: 840, height: 840, borderRadius: "50%", border: `5px solid color-mix(in oklch, ${C.champagne} 55%, transparent)`, boxShadow: `inset 0 0 60px color-mix(in oklch, ${C.champagne} 12%, transparent), ${glow(C.champagne, 0.35)}` }} />
    <div style={{ position: "absolute", left: 104, top: 104, width: 792, height: 792, borderRadius: "50%", border: `1.5px solid color-mix(in oklch, ${C.champagne} 25%, transparent)` }} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Img src={staticFile("brand/unison-mark-porcelain.svg")} style={{ height: 560, marginTop: 10, filter: `drop-shadow(0 0 28px color-mix(in oklch, ${C.champagne} 45%, transparent)) drop-shadow(0 12px 30px rgba(0,0,0,0.6))` }} />
    </AbsoluteFill>
    <Grain opacity={0.04} />
  </AbsoluteFill>
);

/** The header: the tagline and what it means, over the feed's own heartbeat. */
export const XHeader = () => (
  <Ground light={C.champagne} x={50} y={36} strength={0.16}>
    <svg width={1500} height={500} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <filter id="x-glow" x="-5%" y="-60%" width="110%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient id="x-fade" x1="0" x2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.15" />
          <stop offset="0.3" stopColor="white" stopOpacity="0.75" />
          <stop offset="0.7" stopColor="white" stopOpacity="0.75" />
          <stop offset="1" stopColor="white" stopOpacity="0.15" />
        </linearGradient>
        <mask id="x-mask">
          <rect width="1500" height="500" fill="url(#x-fade)" />
        </mask>
      </defs>
      <g mask="url(#x-mask)" opacity={0.55}>
        <path d={heartbeat(-20, 1520, 408, 72)} fill="none" stroke={C.accent} strokeWidth={7} opacity={0.5} filter="url(#x-glow)" strokeLinejoin="round" />
        <path d={heartbeat(-20, 1520, 408, 72)} fill="none" stroke={C.accent} strokeWidth={2.2} strokeLinejoin="round" />
      </g>
    </svg>
    <div style={{ position: "absolute", left: 0, right: 0, top: 92, textAlign: "center" }}>
      <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 22, letterSpacing: "0.32em", color: C.champagne }}>● LIVE ON MONAD MAINNET</div>
      <div style={{ fontFamily: F.display, fontSize: 96, lineHeight: 1.05, marginTop: 14, color: C.ink, textShadow: glow(C.champagne, 0.45) }}>Prices nobody saw first.</div>
      <div style={{ fontFamily: F.text, fontSize: 29, color: C.ink2, marginTop: 14 }}>An exchange for tokenized stocks where every order is sealed before its price exists.</div>
    </div>
    <div style={{ position: "absolute", right: 70, top: 318, fontFamily: F.mono, fontSize: 22, color: C.ink3, letterSpacing: "0.04em" }}>unisonfi.com</div>
  </Ground>
);

/** A post card: how an order is priced, on the photo finish's real auction. */
export const XHow = () => {
  const u = PHOTO_FINISH.unison;
  const steps = [
    { n: "1", label: "Sealed", big: u.sealedAt, note: `UTC. Your order is in, sealed in block ${u.upTo.toLocaleString("en-US")}. Its price doesn't exist yet.`, color: C.champagne },
    { n: "2", label: "Observed", big: "+6 s", note: `Chainlink observes MON/USD at ${u.observedAt}, after the seal. The contract proves it is the first.`, color: C.accent },
    { n: "3", label: "One price", big: `$${u.price}`, note: "for everyone in the auction. Nobody saw it first, not even us.", color: C.buy },
  ];
  return (
    <Ground light={C.champagne} x={50} y={28} strength={0.15}>
      <Img src={staticFile("brand/unison-lockup-porcelain.svg")} style={{ position: "absolute", left: 70, top: 62, height: 40 }} />
      <div style={{ position: "absolute", left: 70, right: 70, top: 150 }}>
        <div style={{ fontFamily: F.display, fontSize: 104, lineHeight: 1.02 }}>Sealed before its price exists.</div>
        <div style={{ fontFamily: F.text, fontSize: 32, color: C.ink2, marginTop: 14 }}>How every Unison auction is priced, on a real one: Monad mainnet, 6 October 2026.</div>
      </div>
      <div style={{ position: "absolute", left: 70, right: 70, top: 440, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 34 }}>
        {steps.map((s) => (
          <div key={s.n} style={{ borderRadius: 26, padding: "30px 34px", background: `linear-gradient(150deg, color-mix(in oklch, ${s.color} 14%, ${C.raised}), ${C.sunken})`, border: `1.5px solid color-mix(in oklch, ${s.color} 55%, transparent)`, boxShadow: glow(s.color, 0.3), minHeight: 300 }}>
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 24, letterSpacing: "0.16em", textTransform: "uppercase", color: s.color }}>
              {s.n} · {s.label}
            </div>
            <div style={{ fontFamily: F.display, fontSize: 84, lineHeight: 1.05, marginTop: 14, color: C.ink, textShadow: glow(s.color, 0.5) }}>{s.big}</div>
            <div style={{ fontFamily: F.text, fontSize: 27, lineHeight: 1.35, color: C.ink2, marginTop: 14 }}>{s.note}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", right: 70, top: 68, fontFamily: F.mono, fontSize: 24, color: C.ink3 }}>unisonfi.com</div>
    </Ground>
  );
};

/** A post card: the two powers exchange v3 took from the team (Monad mainnet, 10 October 2026). */
export const XPowers = () => {
  const powers = [
    { gone: "Trap your orders", now: "Pause, halt or delist a market, and every waiting order goes back at once. No oracle needed." },
    { gone: "Let someone new act for your account", now: "That now takes an upgrade. Next, every upgrade waits 7 days in public." },
  ];
  return (
    <Ground light={C.champagne} x={50} y={24} strength={0.14}>
      <Img src={staticFile("brand/unison-lockup-porcelain.svg")} style={{ position: "absolute", left: 70, top: 62, height: 40 }} />
      <div style={{ position: "absolute", right: 70, top: 68, fontFamily: F.mono, fontSize: 24, color: C.ink3 }}>unisonfi.com</div>
      <div style={{ position: "absolute", left: 70, right: 70, top: 150 }}>
        <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 26, letterSpacing: "0.16em", textTransform: "uppercase", color: C.champagne }}>Exchange v3 · live on Monad mainnet</div>
        <div style={{ fontFamily: F.display, fontSize: 104, lineHeight: 1.02, marginTop: 12 }}>Two powers we gave up today.</div>
      </div>
      <div style={{ position: "absolute", left: 70, right: 70, top: 398, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
        {powers.map((p) => (
          <div key={p.gone} style={{ borderRadius: 28, padding: "34px 40px", background: `linear-gradient(150deg, color-mix(in oklch, ${C.sell} 9%, ${C.raised}), ${C.sunken})`, border: `1.5px solid color-mix(in oklch, ${C.sell} 42%, transparent)`, minHeight: 340, display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 22, letterSpacing: "0.16em", textTransform: "uppercase", color: C.sell }}>Gone</div>
            <div style={{ fontFamily: F.text, fontWeight: 500, fontSize: 48, lineHeight: 1.2, marginTop: 12, color: C.ink2, textDecorationLine: "line-through", textDecorationColor: C.sell, textDecorationThickness: 4 }}>{p.gone}</div>
            <div style={{ fontFamily: F.text, fontSize: 28, lineHeight: 1.38, color: C.ink, marginTop: "auto", paddingTop: 22 }}>{p.now}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 70, bottom: 54, fontFamily: F.text, fontSize: 24, color: C.ink3 }}>
        Block 112,255,125 · rehearsed on a fork of live mainnet first · verified on Sourcify · the record: github.com/iamdflame/unison
      </div>
    </Ground>
  );
};

/** A post card: the week of real prices, replayed under both rules. */
export const XWeek = () => {
  const r = CHALLENGE.replay;
  return (
    <Ground light={C.sell} x={30} y={46} strength={0.12}>
      <Img src={staticFile("brand/unison-lockup-porcelain.svg")} style={{ position: "absolute", left: 70, top: 62, height: 40 }} />
      <div style={{ position: "absolute", right: 70, top: 68, fontFamily: F.mono, fontSize: 24, color: C.ink3 }}>unisonfi.com</div>
      <div style={{ position: "absolute", left: 70, right: 70, top: 150 }}>
        <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 26, letterSpacing: "0.16em", textTransform: "uppercase", color: C.champagne }}>A week of real MON prices, replayed</div>
        <div style={{ fontFamily: F.display, fontSize: 80, lineHeight: 1.05, marginTop: 12, whiteSpace: "nowrap" }}>Same sniper. Same signal. Two rules.</div>
      </div>
      <div style={{ position: "absolute", left: 70, right: 70, top: 400, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
        {[
          { v: `+${r.oldBps.toFixed(1)} bp`, label: "a trade for the sniper", sub: "on the old rule: price at the last observation on chain", color: C.sell },
          { v: `−${Math.abs(r.causalBps).toFixed(1)} bp`, label: "a trade for the sniper", sub: "on Unison: price at the first observation after the seal", color: C.accent },
        ].map((x) => (
          <div key={x.v} style={{ borderRadius: 28, padding: "34px 40px", background: `linear-gradient(150deg, color-mix(in oklch, ${x.color} 13%, ${C.raised}), ${C.sunken})`, border: `1.5px solid color-mix(in oklch, ${x.color} 55%, transparent)` }}>
            <div style={{ fontFamily: F.display, fontSize: 150, lineHeight: 1, color: x.color, textShadow: glow(x.color, 0.9) }}>{x.v}</div>
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 32, color: C.ink, marginTop: 16 }}>{x.label}</div>
            <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink2, marginTop: 6 }}>{x.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 70, bottom: 54, fontFamily: F.text, fontSize: 24, color: C.ink3 }}>
        {r.trades.toLocaleString("en-US")} Coinbase trades and {r.rounds.toLocaleString("en-US")} Chainlink rounds, replayed. The evidence: docs/evidence/challenge.md on github.com/iamdflame/unison
      </div>
    </Ground>
  );
};
