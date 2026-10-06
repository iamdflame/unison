import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";
import { type TermLine, Terminal } from "../kit/Terminal";

/**
 * "Don't trust us. Check." verify-receipt.mjs replayed line for line from its real run on the agent's sale
 * (src/data/verify-agent-sale.txt), each PASS landing on a beat.
 */
const CMD = "node apps/web/scripts/verify-receipt.mjs 0xdb9ce3c65426143949b193b9cad3a13d94bce3b6e1420cd824d06a1f04955c1f";
export const VERIFY_LINES: TermLine[] = [
  { at: 0.3, kind: "cmd", text: CMD },
  { at: 3.2, kind: "out", text: "auction: market 1, batches up to block 111160954, cleared in block 111161027" },
  { at: 3.5, kind: "dim", text: "  price 28605, volume 10000000000000000000, reference 28659 at 1791326911000 ms, status 0" },
  { at: 4.4, kind: "pass", text: "PASS  receipt hash recomputes: 0x71bb199b56e60a9ca07afe3e4df2fd353b6d0f0c28f198949ce33ab8c98299e8" },
  { at: 5.0, kind: "dim", text: "  Chainlink feed 0xBcD78f76005B7515837af6b50c7C52BCf73822fb, round 18446744073710160724: answer 2865393, observed 1791326911, landed 1791326924" },
  { at: 5.6, kind: "pass", text: "PASS  the receipt's reference time is Chainlink's observation time (1791326911)" },
  { at: 6.6, kind: "pass", text: "PASS  observed strictly before the report landed on chain (a signed observation, not a block time)" },
  { at: 7.6, kind: "pass", text: "PASS  the newest order was sealed in block 111160954, at 1791326903" },
  { at: 8.6, kind: "pass", text: "PASS  observed 8 s after the seal (more than the 2 s skew)" },
  { at: 9.6, kind: "pass", text: "PASS  the round before it was observed at 1791326881, not after the seal: no earlier observation qualified" },
  { at: 10.6, kind: "hint", text: "every check passed" },
];

export const Verify = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  const passes = VERIFY_LINES.filter((l) => l.kind === "pass" && t >= l.at).length;
  const title = settle(interpolate(t, [0, 0.6], [0, 1]));
  return (
    <AbsoluteFill style={{ background: C.bg, alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", opacity: title }}>
        <div style={{ fontFamily: F.display, fontSize: 88, color: C.ink }}>Don't trust us. Check.</div>
      </div>
      <div style={{ marginTop: 90 }}>
        <Terminal title="anyone's machine · Monad mainnet RPC" lines={VERIFY_LINES} width={1680} fontSize={22} />
      </div>
      <div style={{ position: "absolute", right: 140, bottom: 70, fontFamily: F.display, fontSize: 64, color: passes === 6 ? C.buy : C.ink3 }}>
        {passes} <span style={{ fontFamily: F.text, fontSize: 30 }}>of 6</span>
      </div>
    </AbsoluteFill>
  );
};
