import { AbsoluteFill } from "remotion";
import { C, F } from "../brand";
import { AGENT_SALE as A } from "../data/chain";
import { Backdrop, clamp01, Drift, glow, Label, move, pop, useT, Words } from "../kit/Fx";
import { useLine } from "../kit/Plan";
import { type TermLine, Terminal } from "../kit/Terminal";

/**
 * An agent trades too: the real transcript of mm-plugin-unison in MetaMask's mm CLI on mainnet (docs/evidence/agent-wallet.md),
 * what it did, large, as each step lands; then the CRE sentinel, labelled for what it is: a workflow run in
 * Chainlink's simulator against Monad mainnet (src/data/cre-sim.txt), its own numbers and its own threshold.
 */
const LINES: TermLine[] = [
  { at: 0.3, kind: "cmd", text: A.command },
  { at: 1.6, kind: "intent", text: `Intent: ${A.intent}` },
  { at: 2.2, kind: "dim", text: `Tx submitted: ${A.tx.slice(0, 64)}…` },
  { at: 2.9, kind: "out", text: `Sealed in block ${A.sealedBlock}. Its price doesn't exist yet:` },
  { at: 3.1, kind: "out", text: "the auction prices at Chainlink's first observation after this block." },
  { at: 4.6, kind: "out", text: `Priced: ${A.price} AUSD, one price for everyone in the auction (Chainlink: ${A.reference}).` },
  { at: 5.6, kind: "pass", text: "Receipt: 6 of 6 checks pass against Chainlink's own history." },
  { at: 5.8, kind: "pass", text: A.receipt },
  { at: 6.6, kind: "hint", text: `Hint: Sold 10 WMON at ${A.price} AUSD, the auction's one price; receipt 6/6 verified` },
];
const STEPS = [
  { at: 2.9, label: "Sealed", big: `block ${A.sealedBlock.toLocaleString("en-US")}`, note: "its price doesn't exist yet", color: C.ink },
  { at: 4.6, label: "Priced · one price for everyone", big: `${A.price} AUSD`, note: `Chainlink observed ${A.reference}`, color: C.accent },
  { at: 5.6, label: "Its own receipt", big: "6 / 6 ✓", note: "checked against Chainlink's own history", color: C.buy },
];
// the sentinel's run on 7 October, 02:26 UTC: "MON: Chainlink … at 27045 (observed 16 s ago) vs exchanges 27007 → 14 bp"
const SENTINEL = { feed: "0.027045", exchanges: "0.027007", bps: 14, age: 16, result: "MON:ok:14bp:16s", maxBps: 75, maxSilentSec: 120 };

export const Agent = () => {
  const t = useT();
  const L = [0.46, 2.07, 5.89, 7.56].map((d, i) => useLine("demo-11", i, d));
  const at = L[3]! + 0.25;
  const sentinel = move(t, at, 0.8);
  const needle = clamp01((t - at - 0.9) / 1.1);
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={sentinel > 0.5 ? C.champagne : C.accent} x={70} y={26} strength={0.1} />
      <Drift to={1.03} over={14}>
        <AbsoluteFill style={{ opacity: 1 - sentinel, filter: sentinel > 0 ? `blur(${5 * sentinel}px)` : undefined, transform: `scale(${1 - 0.05 * sentinel})` }}>
          <div style={{ position: "absolute", top: 60, left: 80 }}>
            <Label color={C.accent} size={28}>
              MetaMask Agent Wallet · mm-plugin-unison · Monad mainnet
            </Label>
            <div style={{ fontFamily: F.display, fontSize: 104, lineHeight: 1.05, marginTop: 12 }}>
              <Words text="An agent trades, then checks." at={0.3} stagger={0.08} dur={0.55} />
            </div>
          </div>
          <div style={{ position: "absolute", left: 80, top: 300, opacity: move(t, 0.2, 0.5) }}>
            <Terminal title="mm · mm-plugin-unison" lines={LINES} width={1020} fontSize={20} />
          </div>
          {STEPS.map((st, i) => {
            const k = pop(t, st.at, 0.5);
            const on = t >= st.at;
            return (
              <div key={st.label} style={{ position: "absolute", left: 1160, top: 300 + i * 210, width: 680, height: 186, borderRadius: 26, padding: "26px 34px", background: `linear-gradient(150deg, color-mix(in oklch, ${st.color} 12%, ${C.raised}), ${C.sunken})`, border: `1.5px solid color-mix(in oklch, ${st.color} ${on ? 55 : 15}%, transparent)`, boxShadow: on ? glow(st.color, 0.35) : undefined, opacity: on ? clamp01(k * 1.5) : 0.18, transform: `scale(${on ? 0.92 + 0.08 * Math.min(1.04, k) : 0.96})`, transformOrigin: "0 50%" }}>
                <Label color={st.color} size={24}>
                  {st.label}
                </Label>
                <div style={{ fontFamily: F.display, fontSize: 70, lineHeight: 1.1, marginTop: 6 }}>{st.big}</div>
                <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink2, marginTop: 4 }}>{st.note}</div>
              </div>
            );
          })}
        </AbsoluteFill>

        {/* the sentinel */}
        {sentinel > 0 ? (
          <AbsoluteFill style={{ opacity: sentinel, transform: `translateY(${(1 - sentinel) * 40}px)` }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 110, textAlign: "center" }}>
              <Label color={C.champagne} size={30} style={{ letterSpacing: "0.24em" }}>
                A Chainlink CRE sentinel · every 30 s
              </Label>
              <div style={{ fontFamily: F.display, fontSize: 84, lineHeight: 1.1, marginTop: 14 }}>checks the feed against two exchanges</div>
            </div>
            <div style={{ position: "absolute", left: 200, right: 200, top: 400, display: "flex", justifyContent: "space-between" }}>
              {[
                { label: "Chainlink MON/USD", price: SENTINEL.feed, note: `observed ${SENTINEL.age} s before the check`, color: C.accent },
                { label: "Coinbase · Kraken", price: SENTINEL.exchanges, note: "the DON's median of the two", color: C.champagne },
              ].map((src, i) => (
                <div key={src.label} style={{ width: 640, textAlign: i ? "right" : "left", opacity: move(t, at + 0.2 + 0.2 * i, 0.5) }}>
                  <Label color={src.color} size={28}>
                    {src.label}
                  </Label>
                  <div style={{ fontFamily: F.display, fontSize: 120, lineHeight: 1.05, color: C.ink, textShadow: glow(src.color, 0.5) }}>${src.price}</div>
                  <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink2 }}>{src.note}</div>
                </div>
              ))}
            </div>
            {/* the meter: how far apart, against the line it would halt beyond */}
            <div style={{ position: "absolute", left: 200, right: 200, top: 700 }}>
              <div style={{ position: "relative", height: 26, borderRadius: 13, background: C.raised, boxShadow: `inset 0 0 0 1.5px ${C.lineStrong}` }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(SENTINEL.bps / SENTINEL.maxBps) * 100 * settleOut(needle)}%`, borderRadius: 13, background: `linear-gradient(90deg, ${C.buy}, color-mix(in oklch, ${C.buy} 70%, ${C.ink}))`, boxShadow: glow(C.buy, 0.6) }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontFamily: F.text, fontSize: 26, color: C.ink2 }}>
                <span>
                  <span style={{ fontFamily: F.display, fontSize: 64, color: C.buy, textShadow: glow(C.buy, 0.6) }}>{Math.round(SENTINEL.bps * settleOut(needle))} bp</span> apart: ok
                </span>
                <span style={{ textAlign: "right" }}>
                  halts above {SENTINEL.maxBps} bp
                  <br />
                  with the feed silent {SENTINEL.maxSilentSec} s
                </span>
              </div>
              <div style={{ marginTop: 18, textAlign: "center", fontFamily: F.mono, fontSize: 26, color: C.ink3, opacity: clamp01((t - at - 2.0) / 0.4) }}>
                “{SENTINEL.result}” · run in Chainlink's CRE simulator against Monad mainnet
              </div>
            </div>
          </AbsoluteFill>
        ) : null}
      </Drift>
    </AbsoluteFill>
  );
};

const settleOut = (p: number) => 1 - (1 - clamp01(p)) ** 3;
