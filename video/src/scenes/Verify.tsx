import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";
import { type TermLine, Terminal } from "../kit/Terminal";

/**
 * "Don't trust us. Check." verify-receipt.mjs replayed line for line from its real run on the sale the
 * film just showed (src/data/verify-film-trade.txt), each PASS landing on a beat.
 */
const CMD = "node apps/web/scripts/verify-receipt.mjs 0x0e6ec0c81f3fed414507377584d7b279b90e1f44276a1af14a9a753e78aaaa3a";
export const VERIFY_LINES: TermLine[] = [
  { at: 0.3, kind: "cmd", text: CMD },
  { at: 3.2, kind: "out", text: "auction: market 1, batches up to block 111237596, cleared in block 111237721" },
  { at: 3.5, kind: "dim", text: "  price 26972, volume 9000000000000000000, reference 26915 at 1791350067000 ms, status 0" },
  { at: 4.4, kind: "pass", text: "PASS  receipt hash recomputes: 0x209dc46107cea84b88bb2b1436d7a365aca6b30b5dd5879d4e24064314b2c01b" },
  { at: 5.0, kind: "dim", text: "  Chainlink feed 0xBcD78f76005B7515837af6b50c7C52BCf73822fb, round 18446744073710161328: answer 2691013, observed 1791350067, landed 1791350079" },
  { at: 5.6, kind: "pass", text: "PASS  the receipt's reference time is Chainlink's observation time (1791350067)" },
  { at: 6.6, kind: "pass", text: "PASS  observed strictly before the report landed on chain (a signed observation, not a block time)" },
  { at: 7.6, kind: "pass", text: "PASS  the newest order was sealed in block 111237596, at 1791350043" },
  { at: 8.6, kind: "pass", text: "PASS  observed 24 s after the seal (more than the 2 s skew)" },
  { at: 9.6, kind: "pass", text: "PASS  the round before it was observed at 1791350037, not after the seal: no earlier observation qualified" },
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
