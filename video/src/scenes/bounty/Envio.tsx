import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, F, s } from "../../brand";
import { CHALLENGE } from "../../data/chain";
import { Arrow, Head, Node, ramp } from "../../kit/Diagram";
import { useLine } from "../../kit/Plan";
import { Shot, TAKES, type TakeName } from "../../kit/Screen";
import { type TermLine, Terminal } from "../../kit/Terminal";

/**
 * The Envio indexer's video (envio-01 … envio-04). The diagram is services/indexer's own config.yaml and
 * schema.graphql; the leaderboard is the live /challenge page (capture/live.mjs, ONLY=challenge); the tests are the
 * CI run that replays mainnet's own events (src/data/indexer-ci.txt).
 */
const BOARD: TakeName | null = "06-challenge" in TAKES ? ("06-challenge" as TakeName) : null;

export const EnvioOpen = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 3.4, 6.0].map((d, i) => useLine("envio-01", i, d));
  const entities = ["Challenge", "Account", "Fill", "Observation", "QuoteRound"];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <div style={{ position: "absolute", left: 160, top: 200 }}>
        <div style={{ fontFamily: F.text, fontSize: 26, letterSpacing: "0.16em", color: C.ink2, opacity: ramp(t, L[0]! - 0.2, L[0]! + 0.5) }}>THE STANDING CHALLENGE</div>
        <div style={{ fontFamily: F.display, fontSize: 96, marginTop: 14, opacity: ramp(t, L[0]!, L[0]! + 0.8) }}>Snipe us, and the pot is yours.</div>
        <div style={{ fontFamily: F.text, fontSize: 32, color: C.champagne, marginTop: 18, opacity: ramp(t, L[0]! + 1.2, L[0]! + 1.9) }}>
          {CHALLENGE.pots.causal} on Unison&apos;s rule · {CHALLENGE.pots.old} on the old rule, as a control
        </div>
      </div>
      <div style={{ position: "absolute", left: 160, top: 560, opacity: ramp(t, L[1]! - 0.2, L[1]! + 0.6) }}>
        <div style={{ fontFamily: F.text, fontSize: 24, letterSpacing: "0.14em", color: C.ink3 }}>THE SCOREBOARD</div>
        <div style={{ fontFamily: F.display, fontSize: 72, marginTop: 8 }}>Envio HyperIndex, on Monad mainnet</div>
        <div style={{ fontFamily: F.mono, fontSize: 24, color: C.ink3, marginTop: 10 }}>services/indexer · chain 143 · every challenger</div>
      </div>
      <div style={{ position: "absolute", left: 160, top: 820, display: "flex", gap: 14 }}>
        {entities.map((e, i) => (
          <div key={e} style={{ fontFamily: F.mono, fontSize: 24, color: C.accent, padding: "10px 16px", borderRadius: 10, boxShadow: `0 0 0 1px ${C.lineStrong}`, opacity: ramp(t, L[2]! + i * 0.18, L[2]! + 0.5 + i * 0.18) }}>
            {e}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const EnvioFlow = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 2.6, 5.2, 7.4, 11.4].map((d, i) => useLine("envio-02", i, d));
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="services/indexer · config.yaml" title="Every challenger, registered on the fly." show={ramp(t, 0, 0.7)} />
      {/* the factory: Opened registers each new ChallengeAccount as a contract to index */}
      <Node x={140} y={290} w={380} title="LatencyChallenge" sub="Opened(owner, account): one for Unison's rule, one for the old" show={ramp(t, L[0]! - 0.1, L[0]! + 0.6)} color={C.champagne} />
      <Arrow x0={530} x1={650} y={360} label="registers" show={ramp(t, L[1]! - 0.2, L[1]! + 0.4)} color={C.champagne} />
      <Node x={660} y={290} w={380} title="ChallengeAccount" sub="added to the index the moment it exists: OrderSent, FillRecorded" show={ramp(t, L[1]!, L[1]! + 0.7)} color={C.accent} />
      <Arrow x0={1050} x1={1170} y={360} label="" show={ramp(t, L[2]! - 0.2, L[2]! + 0.4)} />
      <Node x={1180} y={290} w={300} title="Fill" sub="each order's fill, its side and size" show={ramp(t, L[2]!, L[2]! + 0.7)} />
      {/* the feed: its own events give the markout */}
      <Node x={140} y={560} w={380} title="MON/USD feed" sub="NewTransmission: the observation's own time and price" show={ramp(t, L[3]! - 0.1, L[3]! + 0.6)} color={C.buy} />
      <Arrow x0={530} x1={650} y={630} label="" show={ramp(t, L[3]! + 0.3, L[3]! + 0.8)} color={C.buy} />
      <Node x={660} y={560} w={380} title="Observation" sub="indexed by minute, so a late fill finds its markout at once" show={ramp(t, L[3]! + 0.5, L[3]! + 1.1)} />
      <div style={{ position: "absolute", left: 1050, top: 600, width: 430, opacity: ramp(t, L[3]! + 1.0, L[3]! + 1.6) }}>
        <div style={{ height: 2, background: `repeating-linear-gradient(to right, ${C.buy} 0 10px, transparent 10px 18px)` }} />
        <div style={{ fontFamily: F.mono, fontSize: 19, color: C.buy, marginTop: 10 }}>marks each fill at the first observation ≥ placedAt + 60 s</div>
      </div>
      <Node x={1500} y={290} w={280} title="Account" sub="edge, notional, bp: LatencyChallenge.edgeOf, mirrored" show={ramp(t, L[4]! - 0.1, L[4]! + 0.6)} color={C.champagne} />
      <div style={{ position: "absolute", left: 140, top: 830, fontFamily: F.text, fontSize: 22, color: C.ink3, opacity: ramp(t, L[4]!, L[4]! + 0.6) }}>
        The AUSD/USD feed&apos;s rounds price the quote side, as the contract does. Six tests hold the arithmetic to the contract&apos;s.
      </div>
    </AbsoluteFill>
  );
};

export const EnvioBoard = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 4.0, 6.0].map((d, i) => useLine("envio-03", i, d));
  if (!BOARD) {
    // only until the leaderboard is live and captured: the film is never rendered for real without it
    return (
      <AbsoluteFill style={{ background: C.deep, color: C.ink3, alignItems: "center", justifyContent: "center", fontFamily: F.mono, fontSize: 28 }}>
        capture pending: www.unisonfi.com/challenge, the "Every challenger" table
      </AbsoluteFill>
    );
  }
  // the table, after the page's scroll (cut, not shown): 06-challenge has reached it by 4.1 s
  return (
    <AbsoluteFill style={{ background: C.deep }}>
      <Shot take={BOARD} from={4.1} pointer={false} moves={[{ at: 4.1, x: 960, y: 446, zoom: 1.5 }, { at: 4.2, dur: 6, x: 960, y: 406, zoom: 1.75 }]} />
      <div
        style={{
          position: "absolute",
          left: 80,
          bottom: 160,
          padding: "18px 26px",
          borderRadius: 16,
          background: "oklch(0.1 0.006 265 / 0.8)",
          backdropFilter: "blur(12px)",
          border: `1px solid ${C.lineStrong}`,
          opacity: ramp(t, L[1]! - 0.2, L[1]! + 0.5),
        }}
      >
        <div style={{ fontFamily: F.text, fontSize: 20, letterSpacing: "0.16em", color: C.ink2 }}>FROM ENVIO&apos;S GRAPHQL</div>
        <div style={{ fontFamily: F.mono, fontSize: 24, color: C.ink, marginTop: 6 }}>scored as LatencyChallenge.edgeOf scores a claim</div>
      </div>
    </AbsoluteFill>
  );
};

// GitHub Actions' indexer job on 6 October 2026, 22:33 UTC (src/data/indexer-ci.txt)
const CI: string[] = [
  "> vitest run",
  " RUN  v5.0.3 /home/runner/work/unison/unison/services/indexer",
  " ✓ test/handlers.test.ts (2 tests) 543ms",
  "   ✓ the indexer, on Monad mainnet's own events (2)",
  "     ✓ registers the account from Opened, records its fill and marks it at its markout observation 534ms",
  " ✓ test/score.test.ts (6 tests) 6ms",
  " Test Files  2 passed (2)",
  "      Tests  8 passed (8)",
];

export const EnvioTests = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 2.8, 3.8].map((d, i) => useLine("envio-04", i, d));
  const lines: TermLine[] = [
    { at: L[0]!, kind: "cmd", text: "pnpm test   # services/indexer, on CI" },
    ...CI.map((text, i) => ({ at: L[0]! + 0.8 + i * 0.22, kind: (text.includes("✓") || text.includes("passed") ? "pass" : "dim") as TermLine["kind"], text })),
  ];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="GITHUB ACTIONS · UBUNTU · 6 OCTOBER 2026" title="Its tests replay mainnet's own blocks." show={ramp(t, 0, 0.7)} />
      <div style={{ position: "absolute", left: 140, top: 270 }}>
        <Terminal title="CI · Envio indexer (codegen, types, the handlers replaying mainnet)" lines={lines} width={1640} fontSize={22} typeCps={70} maxLines={10} />
      </div>
      <div style={{ position: "absolute", left: 140, bottom: 110, fontFamily: F.display, fontSize: 72, color: C.champagne, opacity: ramp(t, L[1]! - 0.1, L[1]! + 0.7) }}>
        Snipe us, and Envio will show everyone.
      </div>
    </AbsoluteFill>
  );
};
