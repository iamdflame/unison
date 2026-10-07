import { AbsoluteFill } from "remotion";
import { C, F } from "../brand";
import { Backdrop, clamp01, Drift, Flash, glow, Label, move, pop, Sweep, useT, Words } from "../kit/Fx";
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

/** Each check in the verifier's own words: its PASS line, up to where it explains itself. */
const CHECKS = VERIFY_LINES.filter((l) => l.kind === "pass").map((l) => {
  const said = l.text.replace(/^PASS\s+/, "");
  // the last check's point is after its colon; the others' before their parenthesis or colon
  const words = said.includes("no earlier observation qualified") ? "no earlier observation qualified" : said.split(/\s*[(:]/)[0]!;
  return { at: l.at, words: words.replace(/block (\d+)/, (_, n: string) => `block ${Number(n).toLocaleString("en-US")}`) };
});
const ALL = VERIFY_LINES.find((l) => l.kind === "hint")!.at;

export const Verify = () => {
  const t = useT();
  const passes = CHECKS.filter((c) => t >= c.at).length;
  const done = clamp01((t - ALL) / 0.5);
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.buy} x={74} y={30} strength={0.08 + 0.1 * done} />
      <Drift to={1.025} over={12.7}>
        <div style={{ position: "absolute", left: 80, top: 92 }}>
          <div style={{ fontFamily: F.display, fontSize: 112, lineHeight: 1 }}>
            <Words text="Don't trust us." at={0.15} stagger={0.1} dur={0.6} />{" "}
            <span style={{ color: C.champagne, textShadow: glow(C.champagne, 0.8) }}>
              <Words text="Check." at={1.65} dur={0.5} />
            </span>
          </div>
        </div>
        {/* the proof: the verifier's real run, on anyone's machine */}
        <div style={{ position: "absolute", left: 80, top: 268, opacity: move(t, 0.2, 0.6) }}>
          <Terminal title="anyone's machine · Monad mainnet RPC" lines={VERIFY_LINES} width={980} fontSize={19} maxLines={24} />
        </div>
        {/* its six checks, in its own words */}
        <div style={{ position: "absolute", left: 1120, top: 262, width: 720 }}>
          {CHECKS.map((c, i) => {
            const on = t >= c.at;
            const k = pop(t, c.at, 0.45);
            return (
              <div key={c.at} style={{ display: "flex", alignItems: "center", gap: 26, height: 104, opacity: 0.35 + 0.65 * move(t, c.at - 0.1, 0.3) }}>
                <div style={{ width: 64, height: 64, flex: "none", borderRadius: 32, border: `3px solid ${on ? C.buy : C.lineStrong}`, background: on ? C.buy : "transparent", boxShadow: on ? glow(C.buy, 0.8) : undefined, transform: `scale(${on ? Math.max(0.6, k) : 1})`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.text, fontWeight: 600, fontSize: 38, color: C.deep }}>
                  {on ? "✓" : i + 1}
                </div>
                <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 31, lineHeight: 1.18, color: on ? C.ink : C.ink3 }}>{c.words}</div>
              </div>
            );
          })}
        </div>
        {/* six of six */}
        <div style={{ position: "absolute", right: 80, top: 80, textAlign: "right" }}>
          <div style={{ fontFamily: F.display, fontSize: 150, lineHeight: 1, color: passes === CHECKS.length ? C.champagne : C.ink3, textShadow: passes === CHECKS.length ? glow(C.champagne, 1) : undefined, transform: `scale(${done > 0 ? Math.max(0.8, pop(t, ALL, 0.5)) : 1})`, transformOrigin: "100% 50%" }}>
            <Sweep at={ALL + 0.3}>
              {passes}/{CHECKS.length}
            </Sweep>
          </div>
          <Label color={passes === CHECKS.length ? C.buy : C.ink3} size={26}>
            checks pass
          </Label>
        </div>
      </Drift>
      {CHECKS.map((c) => (
        <Flash key={c.at} at={c.at} peak={0.06} dur={0.25} color={C.buy} />
      ))}
    </AbsoluteFill>
  );
};
