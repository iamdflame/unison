import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, F, s } from "../../brand";
import rounds from "../../data/mon-rounds.json";
import { Arrow, Head, Node, ramp } from "../../kit/Diagram";
import { useLine } from "../../kit/Plan";
import { type TermLine, Terminal } from "../../kit/Terminal";

/**
 * The Chainlink CRE sentinel's video (cre-01 … cre-05). The heartbeat is Chainlink's MON/USD feed on Monad, 40 real
 * rounds (src/data/mon-rounds.json); the rule is the sentinel's own (cre/unison/src/logic.ts) with its unit tests'
 * cases; the terminal is the CRE CLI's simulation against Monad mainnet on 7 October 2026 (src/data/cre-sim.txt).
 */
const R = rounds.rounds;
const T0 = R[0]!.observedAt;
const T1 = R.at(-1)!.landedAt;
const X0 = 160;
const X1 = 1760;
const tx = (sec: number) => X0 + ((sec - T0) / (T1 - T0)) * (X1 - X0);

export const CreWhy = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 5.0, 7.4, 9.0].map((d, i) => useLine("cre-01", i, d));
  const sweep = ramp(t, 0.3, L[1]! + 1.5);
  const head = tx(T0) + (tx(T1) - tx(T0)) * sweep;
  const base = 600;
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <div style={{ position: "absolute", left: 160, top: 150, maxWidth: 1500, fontFamily: F.text, fontSize: 34, color: C.ink2, opacity: ramp(t, 0.2, 0.9) }}>
        Unison prices every auction at Chainlink&apos;s first observation after its orders are sealed.
      </div>
      <div style={{ position: "absolute", left: 160, top: 230, fontFamily: F.display, fontSize: 92, opacity: ramp(t, L[1]! - 0.1, L[1]! + 0.7) }}>The feed is the venue&apos;s heartbeat.</div>
      {/* the feed's own rounds: each observation, and its landing on chain ~13 s later */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <line x1={X0} x2={X1} y1={base} y2={base} stroke={C.line} strokeWidth={2} />
        {R.map((r) => {
          const xo = tx(r.observedAt);
          const xl = tx(r.landedAt);
          if (xo > head) return null;
          return (
            <g key={r.round}>
              <path d={`M${xo - 10},${base} L${xo - 3},${base - 120} L${xo + 3},${base + 46} L${xo + 9},${base}`} fill="none" stroke={C.accent} strokeWidth={3} strokeLinejoin="round" />
              {xl <= head ? <line x1={xl} x2={xl} y1={base - 16} y2={base + 16} stroke={C.champagne} strokeWidth={3} /> : null}
            </g>
          );
        })}
        <line x1={head} x2={head} y1={base - 150} y2={base + 70} stroke={C.ink} strokeWidth={1.5} opacity={sweep < 1 ? 0.6 : 0} />
      </svg>
      <div style={{ position: "absolute", left: X0, top: base + 90, display: "flex", gap: 40, fontFamily: F.text, fontSize: 22, color: C.ink3, opacity: ramp(t, 1.0, 1.8) }}>
        <span>
          <span style={{ color: C.accent }}>▲</span> Chainlink observes MON/USD
        </span>
        <span>
          <span style={{ color: C.champagne }}>|</span> its report lands on Monad, 12–14 s later
        </span>
        <span>40 real rounds, 7 Oct 2026, {new Date(T0 * 1000).toISOString().slice(11, 16)}–{new Date(T1 * 1000).toISOString().slice(11, 16)} UTC</span>
      </div>
      <div style={{ position: "absolute", left: 160, top: 840, opacity: ramp(t, L[2]! - 0.1, L[2]! + 0.7) }}>
        <div style={{ fontFamily: F.display, fontSize: 68, color: C.champagne }}>A second opinion,</div>
        <div style={{ fontFamily: F.display, fontSize: 68, color: C.ink, marginTop: 4, opacity: ramp(t, L[3]! - 0.1, L[3]! + 0.7) }}>on Chainlink&apos;s Runtime Environment.</div>
      </div>
    </AbsoluteFill>
  );
};

export const CreFlow = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 1.8, 6.4, 8.6].map((d, i) => useLine("cre-02", i, d));
  const nodes = [0, 1, 2];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="THE SENTINEL · cre/unison/workflows/sentinel" title="Every 30 seconds, a second opinion." show={ramp(t, 0, 0.7)} />
      <Node x={140} y={420} w={260} title="Cron" sub="*/30 * * * * *" show={ramp(t, L[0]! - 0.1, L[0]! + 0.6)} color={C.champagne} />
      <Arrow x0={410} x1={520} y={490} label="" show={ramp(t, L[1]! - 0.3, L[1]! + 0.3)} />
      {/* the cards behind are the other nodes, doing the same */}
      {nodes.slice(0, 2).map((n) => (
        <div key={n} style={{ position: "absolute", left: 530 + n * 18, top: 300 + n * 18, width: 640, height: 300, borderRadius: 22, background: C.raised, boxShadow: `0 0 0 1px ${C.lineStrong}`, opacity: ramp(t, L[1]! + n * 0.25, L[1]! + 0.7 + n * 0.25) * 0.6 }} />
      ))}
      {[2].map((n) => (
        <div key={n} style={{ position: "absolute", left: 530 + n * 18, top: 300 + n * 18, width: 640, opacity: ramp(t, L[1]! + n * 0.25, L[1]! + 0.7 + n * 0.25) }}>
          <div style={{ padding: "24px 28px", borderRadius: 22, background: C.raised, boxShadow: `0 0 0 1px ${C.lineStrong}`, minHeight: 252 }}>
            <div style={{ fontFamily: F.text, fontSize: 22, letterSpacing: "0.12em", color: C.ink3 }}>EACH NODE OF THE NETWORK</div>
            <div style={{ fontFamily: F.text, fontSize: 27, fontWeight: 600, marginTop: 14, color: C.accent }}>Reads Monad mainnet</div>
            <div style={{ fontFamily: F.mono, fontSize: 19, color: C.ink2, marginTop: 6 }}>ChainlinkCausalReference.latest(1): price and the time Chainlink signed it</div>
            <div style={{ fontFamily: F.text, fontSize: 27, fontWeight: 600, marginTop: 18, color: C.buy, opacity: ramp(t, L[2]! - 0.1, L[2]! + 0.6) }}>Prices MON from the exchanges</div>
            <div style={{ fontFamily: F.mono, fontSize: 19, color: C.ink2, marginTop: 6, opacity: ramp(t, L[2]! - 0.1, L[2]! + 0.6) }}>Coinbase MON-USD · Kraken MONUSD → their median</div>
          </div>
        </div>
      ))}
      <Arrow x0={1220} x1={1330} y={490} label="" show={ramp(t, L[3]! - 0.3, L[3]! + 0.3)} />
      <Node x={1340} y={400} w={440} title="Consensus" sub="the nodes agree on a median of their medians, then decide" show={ramp(t, L[3]! - 0.1, L[3]! + 0.6)} color={C.champagne} />
    </AbsoluteFill>
  );
};

// the sentinel's rule, and the cases its unit tests hold it to (cre/unison/test/logic.test.ts)
const DEV = 75;
const SILENT = 120;
const PX0 = 260;
const PX1 = 1100;
const PY0 = 900;
const PY1 = 300;
const px = (bp: number) => PX0 + (Math.min(bp, 200) / 200) * (PX1 - PX0);
const py = (sec: number) => PY0 - (Math.min(sec, 360) / 360) * (PY0 - PY1);
const CASES = [
  { bp: 148, sec: 8, label: "a fast move: 148 bp off, observed 8 s ago", verdict: "keeps trading", color: C.buy },
  { bp: 2, sec: 3000, label: "a quiet feed: 2 bp off, silent 50 min", verdict: "keeps trading", color: C.buy },
  { bp: 148, sec: 300, label: "stuck: 148 bp off, silent 5 min", verdict: "halts", color: C.sell },
  { bp: 14, sec: 16, label: "mainnet today: 14 bp, 16 s", verdict: "keeps trading", color: C.accent },
];

export const CreRule = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 2.6, 4.0, 7.2].map((d, i) => useLine("cre-03", i, d));
  const when = [L[2]! + 0.3, L[1]! + 1.6, L[1]!, L[3]! + 0.6];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="THE RULE · sentinelDecision" title="Far off, and silent. Both." show={ramp(t, 0, 0.7)} />
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <rect x={px(DEV)} y={PY1} width={PX1 - px(DEV)} height={py(SILENT) - PY1} fill="oklch(0.66 0.115 33 / 0.16)" opacity={ramp(t, L[1]! - 0.2, L[1]! + 0.6)} />
        <line x1={PX0} x2={PX1} y1={PY0} y2={PY0} stroke={C.lineStrong} strokeWidth={2} />
        <line x1={PX0} x2={PX0} y1={PY0} y2={PY1} stroke={C.lineStrong} strokeWidth={2} />
        <line x1={px(DEV)} x2={px(DEV)} y1={PY0} y2={PY1} stroke={C.champagne} strokeWidth={1.5} strokeDasharray="6 6" opacity={ramp(t, L[0]!, L[0]! + 0.6)} />
        <line x1={PX0} x2={PX1} y1={py(SILENT)} y2={py(SILENT)} stroke={C.champagne} strokeWidth={1.5} strokeDasharray="6 6" opacity={ramp(t, L[1]! - 0.2, L[1]! + 0.4)} />
        {CASES.map((k, i) => {
          const show = ramp(t, when[i]!, when[i]! + 0.5);
          return <circle key={k.label} cx={px(k.bp)} cy={py(k.sec)} r={12 * show} fill={k.color} />;
        })}
      </svg>
      <div style={{ position: "absolute", left: PX0, top: PY0 + 18, width: PX1 - PX0, textAlign: "center", fontFamily: F.text, fontSize: 22, color: C.ink3 }}>feed vs the exchanges, bp (halts above {DEV})</div>
      <div style={{ position: "absolute", left: PX0 - 230, top: PY1 - 6, width: 210, textAlign: "right", fontFamily: F.text, fontSize: 22, color: C.ink3 }}>seconds since Chainlink&apos;s last observation (halts above {SILENT})</div>
      <div style={{ position: "absolute", left: px(DEV) + 16, top: PY1 + 14, fontFamily: F.text, fontSize: 26, fontWeight: 600, color: C.sell, opacity: ramp(t, L[1]!, L[1]! + 0.6) }}>HALT</div>
      <div style={{ position: "absolute", left: 1180, top: 330, width: 620 }}>
        {CASES.map((k, i) => (
          <div key={k.label} style={{ display: "flex", gap: 16, alignItems: "baseline", marginTop: i ? 34 : 0, opacity: ramp(t, when[i]!, when[i]! + 0.5) }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: k.color, flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink }}>{k.label}</div>
              <div style={{ fontFamily: F.text, fontSize: 24, color: k.color, marginTop: 4 }}>{k.verdict}</div>
            </div>
          </div>
        ))}
        <div style={{ fontFamily: F.text, fontSize: 20, color: C.ink3, marginTop: 40, opacity: ramp(t, L[3]!, L[3]! + 0.6) }}>The first three are the sentinel&apos;s unit tests.</div>
      </div>
    </AbsoluteFill>
  );
};

// the CRE CLI's own output (ANSI colour codes removed), 7 October 2026 02:26 UTC
const SIM: { cmd: string; log: string; result: string }[] = [
  {
    cmd: "cre workflow simulate unison/workflows/sentinel --target production-settings --non-interactive --trigger-index 0",
    log: "2026-10-07T02:26:41Z [USER LOG] MON: Chainlink round 18446744073710161055 at 27045 (observed 16 s ago) vs exchanges 27007 → 14 bp",
    result: '"MON:ok:14bp:16s"',
  },
  {
    cmd: "cre workflow simulate unison/workflows/sentinel --target demo-settings --non-interactive --trigger-index 0",
    log: "2026-10-07T02:26:49Z [USER LOG] MON: Chainlink round 18446744073710161055 at 27045 (observed 25 s ago) vs exchanges 27007 → 14 bp",
    result: '"MON:HALT:14bp:25s"',
  },
];

export const CreSim = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 3.4, 4.8, 6.8, 8.0, 10.0].map((d, i) => useLine("cre-04", i, d));
  const lines: TermLine[] = [
    { at: L[0]!, kind: "cmd", text: SIM[0]!.cmd },
    { at: L[0]! + 1.8, kind: "dim", text: "✓ Workflow compiled" },
    { at: L[0]! + 2.2, kind: "dim", text: "2026-10-07T02:26:39Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0" },
    { at: L[1]! - 0.1, kind: "out", text: SIM[0]!.log },
    { at: L[3]! - 0.1, kind: "dim", text: "✓ Workflow Simulation Result:" },
    { at: L[3]!, kind: "pass", text: SIM[0]!.result },
    { at: L[4]! - 0.2, kind: "cmd", text: SIM[1]!.cmd },
    { at: L[4]! + 1.6, kind: "out", text: SIM[1]!.log },
    { at: L[5]! + 0.4, kind: "dim", text: "✓ Workflow Simulation Result:" },
    { at: L[5]! + 0.5, kind: "fail", text: SIM[1]!.result },
  ];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="CHAINLINK'S CRE SIMULATOR · AGAINST MONAD MAINNET" title="Keep trading. Or halt." show={ramp(t, 0, 0.7)} />
      <div style={{ position: "absolute", left: 140, top: 270 }}>
        <Terminal title="cre · CRE CLI v1.36.0" lines={lines} width={1640} fontSize={20} typeCps={90} maxLines={14} />
      </div>
      <div style={{ position: "absolute", left: 140, bottom: 70, fontFamily: F.text, fontSize: 22, color: C.ink3, opacity: ramp(t, L[4]!, L[4]! + 0.6) }}>
        demo-settings sets both thresholds to zero, to show the halt path: the same code and the same mainnet reads.
      </div>
    </AbsoluteFill>
  );
};

export const CreClose = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 1.8, 4.6].map((d, i) => useLine("cre-05", i, d));
  return (
    <AbsoluteFill style={{ background: C.deep, color: C.ink }}>
      <Node x={160} y={260} w={420} title="The sentinel's report" sub="KIND_HALT for market 1, the reason inside" show={ramp(t, L[0]! - 0.2, L[0]! + 0.5)} color={C.champagne} />
      <Arrow x0={590} x1={720} y={330} label="" show={ramp(t, L[0]! + 0.2, L[0]! + 0.7)} />
      <Node x={730} y={260} w={420} title="CREAuditReceiver" sub="only Chainlink's forwarder, only our workflow; calls setHalt" show={ramp(t, L[0]! + 0.4, L[0]! + 1.0)} />
      <Arrow x0={1160} x1={1290} y={330} label="" show={ramp(t, L[0]! + 0.8, L[0]! + 1.3)} />
      <Node x={1300} y={260} w={460} title="The exchange" sub="halted: the next auction trades nothing and returns every order" show={ramp(t, L[1]! - 0.2, L[1]! + 0.5)} color={C.sell} />
      <div style={{ position: "absolute", left: 160, top: 560, fontFamily: F.display, fontSize: 84, opacity: ramp(t, L[0]! - 0.1, L[0]! + 0.7) }}>A halt moves no funds.</div>
      <div style={{ position: "absolute", left: 160, top: 690, fontFamily: F.display, fontSize: 56, color: C.ink2, opacity: ramp(t, L[2]! - 0.1, L[2]! + 0.7) }}>Lifting it stays with the guardian.</div>
      <div style={{ position: "absolute", left: 160, bottom: 90, fontFamily: F.text, fontSize: 22, color: C.ink3, opacity: ramp(t, L[2]! + 0.4, L[2]! + 1.0) }}>
        Runs in Chainlink&apos;s simulator today: a live DON needs CRE deploy access, still in early access. docs/evidence/cre.md
      </div>
    </AbsoluteFill>
  );
};
