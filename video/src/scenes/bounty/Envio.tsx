import { AbsoluteFill } from "remotion";
import { C, F } from "../../brand";
import { CHALLENGE, CHALLENGE_URL } from "../../data/chain";
import { Backdrop, clamp01, Drift, glow, Label, move, Narration, pop, Ring, Sweep, useT, Words } from "../../kit/Fx";
import { useLine } from "../../kit/Plan";
import { QR } from "../../kit/QR";
import { Shot, TAKES, type TakeName } from "../../kit/Screen";
import { type TermLine, Terminal } from "../../kit/Terminal";
import { Chip, Flow, NodeBox, said } from "./parts";

/**
 * The Envio indexer's film (envio-01 … envio-04). The diagram is services/indexer's own config.yaml and handlers; the
 * leaderboard is the live /challenge page (capture/live.mjs, ONLY=challenge); the check beside it is Envio's GraphQL
 * read against the contract's own scoring (src/data/envio-vs-contract.txt); the tests are the CI run that replays
 * mainnet's own events (src/data/indexer-ci.txt).
 */
const BOARD: TakeName | null = "06-challenge" in TAKES ? ("06-challenge" as TakeName) : null;
const POT = Number.parseFloat(CHALLENGE.pots.causal);

export const EnvioOpen = () => {
  const t = useT();
  const L = [0.54, 4.28, 6.94].map((d, i) => useLine("envio-01", i, d));
  const lift = move(t, L[1]! - 0.3, 0.8);
  const pot = Math.round(POT * clamp01((t - L[0]! - 1.1) / 1.4));
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={50} y={30 + 8 * lift} strength={0.14} />
      <Drift to={1.035} over={11}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 100 - 50 * lift, textAlign: "center", transform: `scale(${1 - 0.22 * lift})`, transformOrigin: "50% 0", opacity: 1 - 0.45 * lift }}>
          <Label color={C.champagne} size={28}>
            The standing challenge
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 240, lineHeight: 1, marginTop: 18, textShadow: glow(C.champagne, 0.5) }}>
            <Sweep at={L[0]! + 1.4}>
              <Words text="Snipe us." at={Math.min(0.12, L[0]!)} stagger={0.12} dur={0.55} />
            </Sweep>
          </div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 22, marginTop: 26, opacity: move(t, L[0]! + 1.0, 0.5) }}>
            <span style={{ fontFamily: F.display, fontSize: 120, color: C.champagne, textShadow: glow(C.champagne, 0.8) }}>{pot} AUSD</span>
            <span style={{ fontFamily: F.text, fontSize: 36, color: C.ink2 }}>in the pot, on Unison&apos;s rule</span>
          </div>
          <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink3, marginTop: 6, opacity: move(t, L[0]! + 2.0, 0.5) }}>{CHALLENGE.pots.old} on the old rule, as a control</div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 600, textAlign: "center", opacity: move(t, L[1]!, 0.5) }}>
          <div style={{ fontFamily: F.wide, fontWeight: 600, fontSize: 104, letterSpacing: "0.02em", lineHeight: 1, textShadow: glow(C.accent, 0.6) }}>
            <Words text="Envio HyperIndex" at={L[1]!} stagger={0.12} dur={0.5} />
          </div>
          <div style={{ fontFamily: F.display, fontSize: 70, marginTop: 20 }}>
            <Words text="keeps the scoreboard." at={L[1]! + 0.9} stagger={0.08} dur={0.5} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 880, display: "flex", justifyContent: "center", gap: 18 }}>
          {["every challenger", "Monad mainnet · chain 143", "monad.hypersync.xyz", "services/indexer"].map((c, i) => (
            <Chip key={c} text={c} at={L[2]! + i * 0.18} lit={i === 0} size={28} />
          ))}
        </div>
      </Drift>
    </AbsoluteFill>
  );
};

export const EnvioFlow = () => {
  const t = useT();
  const L = [0.46, 3.31, 7.1, 9.8, 13.55].map((d, i) => useLine("envio-02", i, d));
  // the markout, drawn on a strip of time: a fill, Chainlink's observations every 30 s, the first one ≥ 60 s after
  const SX = 640;
  const PX = 6; // px a second
  const fillAt = 15;
  const mark = 90;
  const strip = move(t, L[3]! + 0.2, 0.5);
  const reach = clamp01((t - L[3]! - 0.9) / 1.0);
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.accent} x={46} y={40} strength={0.11} />
      <Drift to={1.02} over={17}>
        <div style={{ position: "absolute", left: 70, top: 50 }}>
          <Label color={C.ink3} size={24}>
            services/indexer · config.yaml and its handlers
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 80, lineHeight: 1.05, marginTop: 8 }}>
            <Words text="Every challenger, registered on the fly." at={0.15} stagger={0.07} dur={0.5} />
          </div>
        </div>
        <NodeBox x={70} y={250} w={420} h={180} title="LatencyChallenge" sub={<span style={{ fontFamily: F.mono, fontSize: 22 }}>Opened(owner, account)</span>} at={L[0]!} lit={L[0]! + 0.5} color={C.champagne} />
        <Flow x0={494} y0={340} x1={610} y1={340} at={L[1]!} color={C.champagne} />
        <div style={{ position: "absolute", left: 552 - 160, width: 320, top: 446, textAlign: "center", fontFamily: F.mono, fontSize: 23, color: C.champagne, opacity: move(t, L[1]! + 0.2, 0.4) }}>contractRegister</div>
        <NodeBox x={620} y={250} w={480} h={180} title="ChallengeAccount" sub="added to the index the block it's created" at={L[1]! + 0.35} lit={L[1]! + 0.6} color={C.accent} style={{ transform: t > L[1]! + 0.35 ? `scale(${Math.max(0.6, pop(t, L[1]! + 0.35, 0.5))})` : undefined }} />
        <Flow x0={1104} y0={340} x1={1214} y1={340} at={L[2]!} color={C.accent} />
        <NodeBox x={1224} y={250} w={330} h={180} title="Fill" sub={<span style={{ fontFamily: F.mono, fontSize: 21 }}>OrderSent · FillRecorded</span>} at={L[2]! + 0.2} lit={L[2]! + 0.4} color={C.ink2} />
        <Flow x0={1558} y0={340} x1={1636} y1={340} at={L[3]! + 2.2} color={C.champagne} />
        <NodeBox x={1646} y={250} w={210} h={180} title="Account" sub="edge, in bp" at={L[3]! + 2.3} lit={L[3]! + 2.5} color={C.champagne} />
        <NodeBox x={70} y={510} w={420} h={180} title="MON/USD feed" sub={<span style={{ fontFamily: F.mono, fontSize: 20 }}>NewTransmission: the answer, and observationsTimestamp</span>} at={L[3]!} lit={L[4]!} color={C.buy} />
        <Flow x0={494} y0={600} x1={610} y1={600} at={L[3]! + 0.35} color={C.buy} />
        <NodeBox x={620} y={510} w={480} h={180} title="Observation" sub="indexed by the minute, so a fill finds its markout at once" at={L[3]! + 0.5} lit={L[4]! + 0.2} color={C.buy} />
        <Flow x0={1104} y0={600} x1={1380} y1={436} at={L[3]! + 1.6} color={C.buy} label="+60 s" />
        <Ring at={L[4]! + 0.05} x={280} y={600} size={700} color={C.buy} />
        {/* the strip of time */}
        <div style={{ position: "absolute", left: SX, top: 740, width: 1220, height: 150, opacity: strip }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 70, height: 2, background: C.lineStrong }} />
          {Array.from({ length: 7 }, (_, k) => {
            const on = k * 30 === mark;
            return (
              <div key={k} style={{ position: "absolute", left: k * 30 * PX - 6, top: 58, width: 12, height: 26, borderRadius: 4, background: on && reach >= 1 ? C.buy : C.ink3, boxShadow: on && reach >= 1 ? glow(C.buy, 0.9) : undefined }} />
            );
          })}
          <div style={{ position: "absolute", left: fillAt * PX - 14, top: 56, width: 28, height: 28, transform: "rotate(45deg)", background: C.champagne, boxShadow: glow(C.champagne, 0.7) }} />
          <div style={{ position: "absolute", left: fillAt * PX - 80, width: 160, top: 100, textAlign: "center", fontFamily: F.text, fontSize: 22, color: C.champagne }}>the fill&apos;s order</div>
          {/* 60 s on, then on to the first observation at or after it */}
          <div style={{ position: "absolute", left: fillAt * PX, top: 24, width: 60 * PX * reach, height: 2, background: C.champagne }} />
          <div style={{ position: "absolute", left: fillAt * PX + 60 * PX - 1, top: 16, width: 2, height: 18, background: C.champagne, opacity: reach >= 1 ? 1 : 0 }} />
          <div style={{ position: "absolute", left: fillAt * PX + 20 * PX, top: -14, fontFamily: F.mono, fontSize: 22, color: C.champagne, opacity: reach }}>60 s</div>
          <div style={{ position: "absolute", left: (fillAt + 60) * PX, top: 24, width: (mark - fillAt - 60) * PX * clamp01((t - L[3]! - 1.9) / 0.4), height: 2, background: C.buy }} />
          <div style={{ position: "absolute", left: mark * PX - 160, width: 320, top: 100, textAlign: "center", fontFamily: F.text, fontSize: 22, color: C.buy, opacity: move(t, L[3]! + 2.2, 0.4) }}>
            its markout: the first observation after
          </div>
          <div style={{ position: "absolute", right: 0, top: 100, whiteSpace: "nowrap", fontFamily: F.text, fontSize: 22, color: C.ink3 }}>Chainlink observes MON about every 30 s</div>
        </div>
        <div style={{ position: "absolute", left: 70, top: 760, width: 520, fontFamily: F.text, fontSize: 23, color: C.ink3, opacity: move(t, L[4]! + 0.6, 0.5) }}>
          AUSD/USD&apos;s rounds price the quote side, as the contract does.
        </div>
      </Drift>
      <Narration lines={said("envio-02", L)} size={44} bottom={36} accent={{ registers: C.champagne, indexed: C.accent, Chainlinks: C.buy, sixty: C.buy }} />
    </AbsoluteFill>
  );
};

/** Where the table's rows are on the captured page (CSS pixels, 06-challenge at 4.5 s). */
const ROW = { label: [478, 586], scores: [935, 1062], old: 371, unison: 434, table: [458, 1462], wins: [717, 761] } as const;
// Envio's GraphQL against LatencyChallenge's own scoring, 7 October 2026 14:17 UTC (src/data/envio-vs-contract.txt)
const CHECK = {
  at: "7 Oct, 14:17 UTC",
  fills: 23,
  rows: [
    { who: "Unison · our sniper", edge: "−0.004250 AUSD", bps: "−22.24 bp", color: C.accent },
    { who: "Old rule · our sniper", edge: "+0.002772 AUSD", bps: "+14.49 bp", color: C.sell },
  ],
};

export const EnvioBoard = () => {
  const t = useT();
  const L = [0.53, 3.96, 6.92, 10.74].map((d, i) => useLine("envio-03", i, d));
  if (!BOARD) {
    // only until the leaderboard is captured: the film is never rendered for real without it
    return (
      <AbsoluteFill style={{ background: C.deep, color: C.ink3, alignItems: "center", justifyContent: "center", fontFamily: F.mono, fontSize: 28 }}>
        capture pending: www.unisonfi.com/challenge, the &quot;Every challenger&quot; table
      </AbsoluteFill>
    );
  }
  const T = 4.1; // the take's second the shot starts on: the table, after the page's scroll
  const check = move(t, L[2]! + 0.3, 0.5) * (1 - move(t, L[3]! - 0.5, 0.4));
  return (
    <AbsoluteFill style={{ background: C.deep }}>
      <Shot
        take={BOARD}
        from={T}
        pointer={false}
        moves={[
          { at: T, x: 960, y: 340, zoom: 1.6 },
          { at: T + 0.05, dur: L[1]! - 0.5, x: 960, y: 362, zoom: 1.72 },
          { at: T + L[1]! - 0.25, dur: 0.9, x: 700, y: 400, zoom: 2.3 },
          { at: T + L[2]! - 0.2, dur: 0.9, x: 880, y: 400, zoom: 1.9 },
          { at: T + L[3]! - 0.4, dur: 1.1, x: 960, y: 560, zoom: 1.42 },
        ]}
        over={({ at }) => {
          const line = (x0: number, x1: number, y: number, draw: number, color: string) => {
            const [a, b] = at(x0, y + 9);
            const [c] = at(x1, y + 9);
            return draw > 0 ? <div style={{ position: "absolute", left: a, top: b, width: (c - a) * draw, height: 4, borderRadius: 2, background: color, boxShadow: glow(color, 0.6) }} /> : null;
          };
          const box = (x0: number, y0: number, x1: number, y1: number, show: number, color: string) => {
            const [a, b] = at(x0, y0);
            const [c, d] = at(x1, y1);
            return show > 0 ? <div style={{ position: "absolute", left: a, top: b, width: c - a, height: d - b, borderRadius: 18, border: `3px solid ${color}`, boxShadow: glow(color, 0.5), opacity: show }} /> : null;
          };
          const labels = clamp01((t - L[1]! - 0.5) / 0.5);
          const scores = move(t, L[2]! + 0.05, 0.4) * (1 - move(t, L[3]! - 0.5, 0.4));
          const wins = move(t, L[3]! + 0.6, 0.5);
          return (
            <>
              {line(ROW.label[0], ROW.label[1], ROW.old, labels, C.champagne)}
              {line(ROW.label[0], ROW.label[1] - 5, ROW.unison, clamp01(labels * 1.4 - 0.4), C.champagne)}
              {box(ROW.scores[0], 336, ROW.scores[1], 458, scores, C.accent)}
              {box(ROW.table[0], ROW.wins[0], ROW.table[1], ROW.wins[1], wins, C.champagne)}
            </>
          );
        }}
      />
      <div style={{ position: "absolute", left: 60, top: 50, padding: "14px 22px", borderRadius: 16, background: "oklch(0.1 0.006 265 / 0.82)", backdropFilter: "blur(12px)", border: `1px solid ${C.lineStrong}`, opacity: move(t, 0.3, 0.5) * (1 - move(t, L[1]! - 0.6, 0.4)) }}>
        <Label color={C.buy} size={20}>
          ● Live · unisonfi.com/challenge
        </Label>
        <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink, marginTop: 4 }}>Every challenger, from Envio&apos;s GraphQL</div>
      </div>
      {/* the same accounts, read twice: from Envio, and scored by the contract's own rules */}
      {check > 0 ? (
        <div style={{ position: "absolute", right: 60, top: 640, width: 740, padding: "24px 32px", borderRadius: 26, background: "oklch(0.1 0.006 265 / 0.9)", backdropFilter: "blur(14px)", border: `1.5px solid ${C.accent}`, boxShadow: glow(C.accent, 0.35), opacity: check, transform: `translateY(${(1 - check) * 24}px)` }}>
          <Label color={C.accent} size={22}>
            Envio = the contract, to the last unit
          </Label>
          <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, marginTop: 6 }}>
            read again {CHECK.at} · {CHECK.fills} counted fills each · edge after fees, AUSD
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr 1fr", columnGap: 18, rowGap: 10, marginTop: 16, alignItems: "baseline" }}>
            <div />
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 21, color: C.ink2 }}>Envio</div>
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 21, color: C.ink2 }}>the contract</div>
            {CHECK.rows.map((r, i) => {
              const on = move(t, L[2]! + 0.7 + i * 0.35, 0.35);
              return [
                <div key={`${r.who}-w`} style={{ fontFamily: F.text, fontSize: 24, color: r.color, opacity: on }}>
                  {r.who}
                </div>,
                <div key={`${r.who}-e`} style={{ fontFamily: F.mono, fontSize: 23, color: C.ink, opacity: on }}>
                  {r.edge.replace(" AUSD", "")}
                </div>,
                <div key={`${r.who}-c`} style={{ fontFamily: F.mono, fontSize: 23, color: C.buy, opacity: on }}>
                  {r.edge.replace(" AUSD", "")} ✓
                </div>,
              ];
            })}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// GitHub Actions' indexer job on 6 October 2026, 22:33 UTC (src/data/indexer-ci.txt)
const CI: string[] = [
  " RUN  v5.0.3 /home/runner/work/unison/unison/services/indexer",
  " ✓ test/handlers.test.ts (2 tests) 543ms",
  "   ✓ the indexer, on Monad mainnet's own events (2)",
  "     ✓ registers the account from Opened, records its fill and marks it at its markout observation 534ms",
  " ✓ test/score.test.ts (6 tests) 6ms",
  " Test Files  2 passed (2)",
  "      Tests  8 passed (8)",
];

export const EnvioTests = () => {
  const t = useT();
  const L = [0.54, 3.32, 4.37].map((d, i) => useLine("envio-04", i, d));
  const lines: TermLine[] = [
    { at: 0.1, kind: "cmd", text: "pnpm test" },
    ...CI.map((text, i) => ({ at: 0.35 + i * 0.15, kind: (text.includes("✓") || text.includes("passed") ? "pass" : "dim") as TermLine["kind"], text })),
  ];
  const away = move(t, L[1]! - 0.35, 0.45);
  const passed = 0.35 + (CI.length - 1) * 0.15;
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={50} y={46} strength={0.1 + 0.1 * move(t, L[1]!, 0.5)} />
      <Drift to={1.03} over={9}>
        <div style={{ position: "absolute", inset: 0, opacity: 1 - away, filter: away > 0 ? `blur(${away * 14}px)` : undefined }}>
          <div style={{ position: "absolute", left: 70, top: 56 }}>
            <Label color={C.ink3} size={24}>
              GitHub Actions · 6 October 2026, 22:33 UTC
            </Label>
            <div style={{ fontFamily: F.display, fontSize: 84, lineHeight: 1.05, marginTop: 8 }}>
              <Words text="Its tests replay real mainnet blocks." at={L[0]!} stagger={0.07} dur={0.5} />
            </div>
          </div>
          <div style={{ position: "absolute", left: 70, top: 260 }}>
            <Terminal title="CI · Envio indexer: codegen, types, the handlers replaying mainnet" lines={lines} width={1200} fontSize={23} typeCps={40} maxLines={10} />
          </div>
          <div style={{ position: "absolute", right: 90, top: 300, textAlign: "right", opacity: move(t, passed, 0.3) }}>
            <div style={{ fontFamily: F.display, fontSize: 230, lineHeight: 1, color: C.buy, textShadow: glow(C.buy, 0.8), transform: `scale(${t > passed ? Math.max(0.6, pop(t, passed, 0.5)) : 0.6})`, transformOrigin: "100% 70%" }}>8/8</div>
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 30, color: C.ink2, marginTop: 8 }}>tests pass</div>
          </div>
        </div>
        {t > L[1]! - 0.3 ? (
          <>
            <div style={{ position: "absolute", left: 120, top: 250, fontFamily: F.display, fontSize: 230, lineHeight: 1, textShadow: glow(C.champagne, 0.5) }}>
              <Words text="Snipe us…" at={L[1]! - 0.1} stagger={0.14} dur={0.5} />
            </div>
            <div style={{ position: "absolute", left: 120, top: 560, fontFamily: F.display, fontSize: 96, color: C.champagne, textShadow: glow(C.champagne, 0.9) }}>
              <Sweep at={L[2]! + 1.2}>
                <Words text="and Envio will show everyone." at={L[2]!} stagger={0.08} dur={0.5} />
              </Sweep>
            </div>
            <Ring at={L[1]!} x={560} y={360} size={1200} />
            <div style={{ position: "absolute", right: 120, top: 250, textAlign: "center", opacity: move(t, L[2]! + 0.3, 0.5), transform: `scale(${t > L[2]! + 0.3 ? Math.max(0.7, pop(t, L[2]! + 0.3, 0.55)) : 0.7})` }}>
              <div style={{ padding: 16, borderRadius: 24, background: C.ink, boxShadow: glow(C.champagne, 0.6) }}>
                <QR url={CHALLENGE_URL} size={250} fg={C.deep} bg={C.ink} />
              </div>
              <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink2, marginTop: 12 }}>unisonfi.com/challenge</div>
            </div>
            <div style={{ position: "absolute", left: 120, top: 760, fontFamily: F.text, fontSize: 26, color: C.ink3, opacity: move(t, L[2]! + 0.8, 0.5) }}>
              github.com/iamdflame/unison · services/indexer
            </div>
          </>
        ) : null}
      </Drift>
    </AbsoluteFill>
  );
};
