import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C, F } from "../brand";
import { CHALLENGE, PHOTO_FINISH } from "../data/chain";
import rounds from "../data/mon-rounds.json";
import { glow } from "../kit/Fx";
import { Grain } from "../kit/Grain";

/**
 * The six uploads' thumbnails (1280 × 720): one claim each, in a few words that still read at the size of a phone's
 * list, over the thing that proves it. Every number is the films' own (src/data); the certificate is the live site's,
 * captured on the film's buy (04-certificate); the photo is the founder's. Nothing important sits in the bottom-right
 * corner, where YouTube prints the running time.
 */
export const TW = 1280;
export const TH = 720;

function Ground({ light = C.champagne, x = 70, y = 40, strength = 0.2, children }: { light?: string; x?: number; y?: number; strength?: number; children: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: C.deep, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 65% 78% at ${x}% ${y}%, color-mix(in oklch, ${light} ${Math.round(strength * 100)}%, transparent), transparent 72%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 50% 60% at ${100 - x}% ${100 - y}%, color-mix(in oklch, ${C.accent} 9%, transparent), transparent 70%)` }} />
      {children}
      <Grain opacity={0.05} />
    </AbsoluteFill>
  );
}

const Lockup = ({ x = 52, y = 46, h = 34 }: { x?: number; y?: number; h?: number }) => <Img src={staticFile("brand/unison-lockup-porcelain.svg")} style={{ position: "absolute", left: x, top: y, height: h }} />;

const Tag = ({ children, x, y, color = C.champagne }: { children: ReactNode; x: number; y: number; color?: string }) => (
  <div style={{ position: "absolute", left: x, top: y, fontFamily: F.text, fontWeight: 600, fontSize: 21, letterSpacing: "0.14em", textTransform: "uppercase", color: C.deep, background: color, padding: "9px 15px", borderRadius: 10, boxShadow: glow(color, 0.35) }}>{children}</div>
);

/** The claim: capitals in Mona Sans Wide, a line at a time; `lit` lines in champagne (or `litColor`), lit. */
function Head({ lines, size, x, y, lit = [], litColor = C.champagne, style }: { lines: string[]; size: number; x: number; y: number; lit?: number[]; litColor?: string; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, fontFamily: F.wide, fontWeight: 600, fontSize: size, lineHeight: 0.98, letterSpacing: "-0.012em", textTransform: "uppercase", whiteSpace: "nowrap", ...style }}>
      {lines.map((l, i) => (
        <div key={l} style={{ color: lit.includes(i) ? litColor : C.ink, textShadow: lit.includes(i) ? glow(litColor, 0.75) : "0 6px 34px rgba(0,0,0,0.7)" }}>
          {l}
        </div>
      ))}
    </div>
  );
}

/** The live demo: the certificate the site issued for the film's own buy. */
export const ThumbDemo = () => (
  <Ground light={C.champagne} x={76} y={46} strength={0.24}>
    <div style={{ position: "absolute", left: 640, top: 138, width: 610, borderRadius: 16, overflow: "hidden", transform: "rotate(-3deg)", boxShadow: `0 44px 100px rgba(0,0,0,0.75), ${glow(C.champagne, 0.6)}` }}>
      <Img src={staticFile("thumbs/certificate.png")} style={{ width: 610, display: "block" }} />
    </div>
    <Lockup />
    <Head lines={["Priced", "after the", "seal."]} size={92} x={50} y={152} lit={[2]} />
    <div style={{ position: "absolute", left: 54, top: 468, fontFamily: F.display, fontSize: 42, color: C.ink2 }}>A real trade, live on Monad</div>
    <Tag x={54} y={566}>The live demo · mainnet</Tag>
  </Ground>
);

/** The pitch: the founder, and the claim the challenge measures. */
export const ThumbPitch = () => (
  <Ground light={C.accent} x={22} y={34} strength={0.17}>
    <div style={{ position: "absolute", right: 0, top: 0, width: 720, height: TH, overflow: "hidden" }}>
      <Img src={staticFile("private/founder.jpg")} style={{ position: "absolute", width: 1464, left: -280, top: -380, filter: "saturate(0.92) contrast(1.06) brightness(0.9)" }} />
      <AbsoluteFill style={{ background: `linear-gradient(90deg, ${C.deep} 0%, ${C.deep} 12%, color-mix(in oklch, ${C.deep} 50%, transparent) 34%, transparent 58%)` }} />
      <AbsoluteFill style={{ background: `linear-gradient(0deg, ${C.deep} 0%, transparent 28%)` }} />
      <AbsoluteFill style={{ background: `color-mix(in oklch, ${C.accent} 10%, transparent)`, mixBlendMode: "soft-light" }} />
    </div>
    <Lockup />
    <Head lines={["Snipers", "lose", "here."]} size={108} x={50} y={140} lit={[2]} />
    <div style={{ position: "absolute", left: 54, top: 490, fontFamily: F.display, fontSize: 42, color: C.ink2 }}>Prices nobody saw first.</div>
    <Tag x={54} y={572}>The pitch · Dflame, founder</Tag>
  </Ground>
);

/** The ad: the photo finish's verdict. */
export const ThumbAd = () => (
  <Ground light={C.sell} x={50} y={50} strength={0.2}>
    <div style={{ position: "absolute", left: 0, right: 0, top: 392, height: 2, background: `linear-gradient(90deg, transparent, ${C.lineStrong}, transparent)` }} />
    <Lockup />
    <div style={{ position: "absolute", left: 0, right: 0, top: 118, textAlign: "center", fontFamily: F.wide, fontWeight: 600, fontSize: 58, letterSpacing: "0.01em", color: C.ink, whiteSpace: "nowrap" }}>SAME TRADE. SAME SECOND.</div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 182, textAlign: "center", fontFamily: F.display, fontSize: 300, lineHeight: 1, color: C.sell, textShadow: glow(C.sell, 1.3) }}>+{PHOTO_FINISH.gapBps} bp</div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 512, textAlign: "center", fontFamily: F.text, fontWeight: 600, fontSize: 32, letterSpacing: "0.16em", textTransform: "uppercase", color: C.ink2 }}>The old rule paid the sniper</div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 570, textAlign: "center", fontFamily: F.display, fontSize: 44, color: C.champagne, textShadow: glow(C.champagne, 0.5) }}>Unison priced it after the seal.</div>
  </Ground>
);

/** The MetaMask plugin: the agent's real run, as the plugin printed it (src/data/mm-live.json, excerpts). */
export const ThumbMetaMask = () => (
  <Ground light={C.accent} x={78} y={40} strength={0.2}>
    <div style={{ position: "absolute", left: 726, top: 150, width: 510, borderRadius: 18, background: "oklch(0.11 0.006 265 / 0.97)", boxShadow: `0 0 0 1px ${C.lineStrong}, 0 44px 100px rgba(0,0,0,0.75), ${glow(C.accent, 0.45)}`, transform: "rotate(2deg)", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: C.lineStrong }} />
        ))}
      </div>
      <div style={{ padding: "22px 24px 26px", fontFamily: F.mono, fontSize: 22, lineHeight: 1.5, color: C.ink2 }}>
        <div style={{ color: C.ink }}>
          <span style={{ color: C.champagne }}>$ </span>mm unison order WMON sell 10
        </div>
        <div style={{ color: C.accent, marginTop: 12 }}>Sealed in block 111202438.</div>
        <div style={{ color: C.ink3 }}>Its price doesn&apos;t exist yet…</div>
        <div style={{ color: C.ink, marginTop: 12 }}>Priced: 0.027168 AUSD</div>
        <div style={{ color: C.buy, marginTop: 12 }}>Receipt: 6 of 6 checks pass</div>
      </div>
    </div>
    <Lockup />
    <Head lines={["AI agent,", "real trade."]} size={74} x={50} y={170} lit={[1]} />
    <div style={{ position: "absolute", left: 54, top: 358, width: 600, fontFamily: F.text, fontSize: 29, lineHeight: 1.35, color: C.ink2 }}>
      <span style={{ fontFamily: F.mono, color: C.ink }}>mm-plugin-unison</span>, for MetaMask&apos;s Agent Wallet, live on Monad mainnet.
    </div>
    <Tag x={54} y={494}>MetaMask Agent Wallet plugin</Tag>
  </Ground>
);

// the last 20 rounds of Chainlink's MON/USD feed, as the film draws them
const R = rounds.rounds.slice(-20);
function heartbeat(x0: number, x1: number, base: number) {
  const t0 = R[0]!.observedAt - 20;
  const t1 = R.at(-1)!.landedAt + 20;
  const lo = Math.min(...R.map((r) => r.price));
  const hi = Math.max(...R.map((r) => r.price));
  const x = (sec: number) => x0 + ((sec - t0) / (t1 - t0)) * (x1 - x0);
  const y = (p: number) => base + 30 - ((p - lo) / (hi - lo)) * 60;
  let level = y(R[0]!.price);
  let d = `M${x0},${level.toFixed(1)}`;
  for (const r of R) {
    const xo = x(r.observedAt);
    const next = y(r.price);
    for (const [px, py] of [[xo - 8, level], [xo - 5.5, level - 6], [xo - 3.5, level], [xo - 1.6, level + 8], [xo, level - 150], [xo + 2.4, next + 44], [xo + 5, next]] as const) d += ` L${px.toFixed(1)},${py.toFixed(1)}`;
    level = next;
  }
  return `${d} L${x1},${level.toFixed(1)}`;
}

/** The CRE sentinel: the feed's heartbeat, and the two verdicts the simulator printed against mainnet. */
export const ThumbCre = () => {
  const d = heartbeat(-20, 1300, 452);
  return (
    <Ground light={C.accent} x={50} y={62} strength={0.2}>
      <svg width={TW} height={TH} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="t-glow" x="-5%" y="-60%" width="110%" height="220%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <path d={d} fill="none" stroke={C.accent} strokeWidth={10} opacity={0.55} filter="url(#t-glow)" strokeLinejoin="round" />
        <path d={d} fill="none" stroke={C.accent} strokeWidth={3.4} strokeLinejoin="round" />
      </svg>
      <Lockup />
      <Head lines={["Keep trading.", "Or halt."]} size={86} x={50} y={116} lit={[1]} litColor={C.sell} />
      <div style={{ position: "absolute", left: 54, top: 548, fontFamily: F.display, fontSize: 40, color: C.ink }}>A Chainlink CRE sentinel for Unison&apos;s feed</div>
      <div style={{ position: "absolute", left: 54, top: 616, display: "flex", gap: 14 }}>
        <div style={{ fontFamily: F.mono, fontSize: 24, color: C.deep, background: C.buy, padding: "7px 14px", borderRadius: 10 }}>MON:ok:14bp:16s</div>
        <div style={{ fontFamily: F.mono, fontSize: 24, color: C.ink, background: C.sell, padding: "7px 14px", borderRadius: 10 }}>MON:HALT:14bp:25s</div>
      </div>
    </Ground>
  );
};

/** Envio: the standing challenge's pot, and the scoreboard it keeps (the /challenge page, 7 October 04:02 UTC). */
export const ThumbEnvio = () => (
  <Ground light={C.champagne} x={26} y={38} strength={0.22}>
    <div style={{ position: "absolute", left: 628, top: 176, width: 610, borderRadius: 22, padding: "26px 30px", boxSizing: "border-box", background: "oklch(0.12 0.006 265 / 0.96)", boxShadow: `0 0 0 1px ${C.lineStrong}, 0 44px 100px rgba(0,0,0,0.75), ${glow(C.accent, 0.35)}`, transform: "rotate(-2deg)" }}>
      <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 20, letterSpacing: "0.16em", color: C.buy }}>● EVERY CHALLENGER · LIVE</div>
      {[
        { who: "Old rule · our sniper", v: `+${CHALLENGE.live.oldBps.toFixed(2)} bp`, color: C.sell },
        { who: "Unison · our sniper", v: `−${Math.abs(CHALLENGE.live.causalBps).toFixed(2)} bp`, color: C.accent },
      ].map((r) => (
        <div key={r.who} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
          <div style={{ whiteSpace: "nowrap" }}>
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 26, color: C.ink }}>{r.who}</div>
            <div style={{ fontFamily: F.text, fontSize: 20, color: C.ink3, marginTop: 4 }}>{CHALLENGE.live.fills} of 30 fills</div>
          </div>
          <div style={{ fontFamily: F.display, fontSize: 56, whiteSpace: "nowrap", color: r.color, textShadow: glow(r.color, 0.6) }}>{r.v}</div>
        </div>
      ))}
      <div style={{ fontFamily: F.text, fontSize: 21, color: C.ink3, marginTop: 20 }}>Indexed by Envio HyperIndex · Monad mainnet</div>
    </div>
    <Lockup />
    <div style={{ position: "absolute", left: 46, top: 112, fontFamily: F.display, fontSize: 212, lineHeight: 0.92, color: C.ink, textShadow: glow(C.champagne, 0.55) }}>
      Snipe
      <br />
      us.
    </div>
    <div style={{ position: "absolute", left: 54, top: 520, fontFamily: F.display, fontSize: 46, color: C.champagne, textShadow: glow(C.champagne, 0.5) }}>{CHALLENGE.pots.causal} in the pot</div>
    <Tag x={54} y={592}>Envio HyperIndex scoreboard</Tag>
  </Ground>
);
