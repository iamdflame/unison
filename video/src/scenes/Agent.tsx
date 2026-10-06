import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";
import { AGENT_SALE as A } from "../data/chain";
import { type TermLine, Terminal } from "../kit/Terminal";

/**
 * An agent trades too: the real transcript of mm-plugin-unison in MetaMask's mm CLI on mainnet (docs/evidence/agent-wallet.md),
 * then the CRE sentinel, labelled for what it is: a workflow run in Chainlink's simulator.
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

export const Agent = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  const head = settle(interpolate(t, [0, 0.7], [0, 1]));
  const sentinel = settle(interpolate(t, [8.4, 9.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const spin = (t * 30) % 360;
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <div style={{ position: "absolute", top: 70, left: 140, opacity: head }}>
        <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink3, letterSpacing: "0.12em" }}>METAMASK AGENT WALLET · MONAD MAINNET</div>
        <div style={{ fontFamily: F.display, fontSize: 80, marginTop: 8 }}>An agent trades, then checks.</div>
      </div>
      <div style={{ position: "absolute", left: 140, top: 300, opacity: 1 - sentinel * 0.6 }}>
        <Terminal title="mm · mm-plugin-unison" lines={LINES} width={1640} fontSize={22} />
      </div>
      <div style={{ position: "absolute", right: 150, bottom: 90, display: "flex", alignItems: "center", gap: 30, opacity: sentinel }}>
        <svg width={170} height={170} viewBox="0 0 170 170">
          <circle cx={85} cy={85} r={78} fill="none" stroke={C.champagne} strokeWidth={1.5} />
          {Array.from({ length: 7 }, (_, i) => {
            const a = ((i * 360) / 7 + spin) * (Math.PI / 180);
            return <circle key={i} cx={85 + 64 * Math.cos(a)} cy={85 + 64 * Math.sin(a)} r={8} fill={i < 4 ? C.champagne : "none"} stroke={C.champagne} strokeWidth={1.5} />;
          })}
          <text x={85} y={92} textAnchor="middle" fill={C.ink} style={{ font: `500 26px ${F.display}` }}>
            4/7
          </text>
        </svg>
        <div>
          <div style={{ fontFamily: F.text, fontSize: 30, fontWeight: 600 }}>A Chainlink CRE sentinel</div>
          <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink2, marginTop: 6 }}>checks the feed against Coinbase and Kraken every 30 s</div>
          <div style={{ fontFamily: F.text, fontSize: 20, color: C.ink3, marginTop: 6 }}>run in Chainlink's CRE simulator against Monad mainnet</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
