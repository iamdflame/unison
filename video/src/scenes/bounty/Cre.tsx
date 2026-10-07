import { AbsoluteFill } from "remotion";
import { C, F } from "../../brand";
import rounds from "../../data/mon-rounds.json";
import { Backdrop, clamp01, Drift, Flash, glow, Label, move, Narration, pop, Ring, Sweep, useT, Words } from "../../kit/Fx";
import { useLine } from "../../kit/Plan";
import { type TermLine, Terminal } from "../../kit/Terminal";
import { Card, Flow, NodeBox, said } from "./parts";

/**
 * The Chainlink CRE sentinel's film (cre-01 … cre-05). The heartbeat is Chainlink's MON/USD feed on Monad: 40 real
 * rounds (src/data/mon-rounds.json). The rule is the sentinel's own (cre/unison/src/logic.ts), with the cases its unit
 * tests hold it to; the terminal is the CRE CLI's simulation against Monad mainnet on 7 October 2026
 * (src/data/cre-sim.txt), its lines as printed.
 */
// the last 20 rounds: ten minutes of the feed, spaced as a monitor draws a pulse
const R = rounds.rounds.slice(-20);
const T0 = R[0]!.observedAt - 20;
const T1 = R.at(-1)!.landedAt + 20;
const PRICES = R.map((r) => r.price);
const PMIN = Math.min(...PRICES);
const PMAX = Math.max(...PRICES);
const LAG = R.map((r) => r.landedAt - r.observedAt);
const hhmm = (sec: number) => new Date(sec * 1000).toISOString().slice(11, 16);
const hms = (sec: number) => new Date(sec * 1000).toISOString().slice(11, 19);

/** The feed as a monitor draws it: a beat at each observation, the line between at the price it observed. */
function heartbeat(x: (sec: number) => number, y: (price: number) => number) {
  let level = y(R[0]!.price);
  const pts: [number, number][] = [[x(T0), level]];
  for (const r of R) {
    const xo = x(r.observedAt);
    const next = y(r.price);
    pts.push([xo - 10, level], [xo - 7, level - 8], [xo - 4.5, level], [xo - 2, level + 10], [xo, level - 178], [xo + 3, next + 52], [xo + 6.5, next]);
    level = next;
  }
  pts.push([x(T1), level]);
  return pts;
}
/** The trace up to `head`, and where its pen is. */
function trace(pts: [number, number][], head: number) {
  let d = "";
  let pen: [number, number] = pts[0]!;
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i]!;
    if (px > head) {
      const [ax, ay] = pts[i - 1] ?? pts[0]!;
      const k = px === ax ? 0 : (head - ax) / (px - ax);
      pen = [head, ay + (py - ay) * k];
      d += ` L${pen[0].toFixed(1)},${pen[1].toFixed(1)}`;
      return { d, pen };
    }
    d += `${i ? " L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
    pen = [px, py];
  }
  return { d, pen };
}

export const CreWhy = () => {
  const t = useT();
  const L = [0.5, 6.4, 8.78, 10.83].map((d, i) => useLine("cre-01", i, d));
  const X0 = 90;
  const X1 = 1830;
  const BASE = 480;
  const x = (sec: number) => X0 + ((sec - T0) / (T1 - T0)) * (X1 - X0);
  const y = (price: number) => BASE + 46 - ((price - PMIN) / (PMAX - PMIN)) * 92;
  const pts = heartbeat(x, y);
  // the pen is already moving on the first frame
  const head = X0 + (0.06 + 0.94 * clamp01(t / (L[1]! + 0.9))) * (X1 - X0);
  const { d, pen } = trace(pts, head);
  const full = trace(pts, X1 + 1).d;
  const last = [...R].reverse().find((r) => x(r.observedAt) <= head) ?? R[0]!;
  // the second opinion: a beam crosses the whole trace, checking each beat
  const scan = clamp01((t - L[2]! - 0.1) / 2.6);
  const beam = X0 - 90 + scan * (X1 - X0 + 180);
  const heart = move(t, L[1]! - 0.05, 0.5) * (1 - move(t, L[2]! - 0.35, 0.3));
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.accent} x={50} y={44} strength={0.12 + 0.06 * Math.max(0, Math.sin(t * 4.2))} />
      <Drift to={1.03} over={14}>
        <div style={{ position: "absolute", left: 90, top: 58 }}>
          <Label color={C.accent} size={26}>
            Chainlink · MON/USD · on Monad mainnet
          </Label>
          <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink3, marginTop: 8 }}>
            {R.length} real rounds · 7 October 2026 · {hhmm(R[0]!.observedAt)}–{hhmm(R.at(-1)!.landedAt)} UTC
          </div>
        </div>
        <div style={{ position: "absolute", right: 90, top: 50, textAlign: "right", opacity: move(t, 0.5, 0.6) }}>
          <div style={{ fontFamily: F.mono, fontSize: 56, color: C.ink, textShadow: glow(C.accent, 0.5) }}>${last.price.toFixed(6)}</div>
          <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, marginTop: 2 }}>observed {hms(last.observedAt)} UTC</div>
        </div>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <defs>
            <filter id="hb-glow" x="-5%" y="-60%" width="110%" height="220%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <clipPath id="hb-beam">
              <rect x={beam - 70} y={0} width={140} height={1080} />
            </clipPath>
            <linearGradient id="hb-band" x1="0" x2="1">
              <stop offset="0" stopColor={C.champagne} stopOpacity={0} />
              <stop offset="0.5" stopColor={C.champagne} stopOpacity={0.16} />
              <stop offset="1" stopColor={C.champagne} stopOpacity={0} />
            </linearGradient>
          </defs>
          <line x1={X0} x2={X1} y1={BASE + 120} y2={BASE + 120} stroke={C.line} strokeWidth={1.5} />
          <path d={d} fill="none" stroke={C.accent} strokeWidth={10} opacity={0.5} filter="url(#hb-glow)" strokeLinejoin="round" />
          <path d={d} fill="none" stroke={C.accent} strokeWidth={3.2} strokeLinejoin="round" strokeLinecap="round" />
          {R.map((r) => {
            const xl = x(r.landedAt);
            return xl <= head ? <circle key={r.round} cx={xl} cy={y(r.price)} r={4.6} fill={C.champagne} /> : null;
          })}
          {head < X1 ? (
            <>
              <line x1={pen[0]} x2={pen[0]} y1={BASE - 230} y2={BASE + 120} stroke={C.ink} strokeWidth={1.2} opacity={0.35} />
              <circle cx={pen[0]} cy={pen[1]} r={16} fill={C.accent} opacity={0.35} filter="url(#hb-glow)" />
              <circle cx={pen[0]} cy={pen[1]} r={6} fill={C.ink} />
            </>
          ) : null}
          {scan > 0 && scan < 1 ? (
            <>
              <rect x={beam - 90} y={BASE - 250} width={180} height={390} fill="url(#hb-band)" />
              <path d={full} fill="none" stroke={C.champagne} strokeWidth={4} clipPath="url(#hb-beam)" strokeLinejoin="round" />
            </>
          ) : null}
        </svg>
        <div style={{ position: "absolute", left: X0, top: BASE + 136, display: "flex", gap: 44, fontFamily: F.text, fontSize: 24, color: C.ink2, opacity: move(t, 1.2, 0.6) }}>
          <span>
            <span style={{ color: C.accent }}>▲</span> Chainlink observes MON/USD
          </span>
          <span>
            <span style={{ color: C.champagne }}>●</span> its report lands on Monad, {Math.min(...LAG)}–{Math.max(...LAG)} s later
          </span>
        </div>
        <div style={{ position: "absolute", left: 90, top: 700, fontFamily: F.display, fontSize: 108, lineHeight: 1, opacity: heart, textShadow: glow(C.accent, 0.4) }}>
          <Words text="The feed is the venue's heartbeat." at={L[1]!} stagger={0.08} dur={0.5} />
        </div>
        {t > L[2]! - 0.2 ? (
          <div style={{ position: "absolute", left: 90, top: 690 }}>
            <div style={{ fontFamily: F.display, fontSize: 108, lineHeight: 1, color: C.champagne, textShadow: glow(C.champagne, 0.7) }}>
              <Words text="A second opinion," at={L[2]!} stagger={0.09} dur={0.5} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 22 }}>
              <div style={{ fontFamily: F.display, fontSize: 70 }}>
                <Words text="on Chainlink's Runtime Environment." at={L[3]!} stagger={0.08} dur={0.5} />
              </div>
              <div style={{ fontFamily: F.wide, fontWeight: 600, fontSize: 40, letterSpacing: "0.08em", padding: "8px 20px", borderRadius: 14, color: C.deep, background: C.accent, boxShadow: glow(C.accent, 0.7), transform: `scale(${t > L[3]! + 1.2 ? Math.max(0.5, pop(t, L[3]! + 1.2, 0.45)) : 0})` }}>CRE</div>
            </div>
          </div>
        ) : null}
      </Drift>
      <Narration lines={said("cre-01", L).slice(0, 1)} size={50} bottom={64} accent={{ first: C.champagne, sealed: C.accent }} />
    </AbsoluteFill>
  );
};

export const CreFlow = () => {
  const t = useT();
  const L = [0.47, 2.77, 7.64, 10.25].map((d, i) => useLine("cre-02", i, d));
  // the cron fires as the nodes are named
  const fire = L[1]! - 0.3;
  const CX = 1040;
  const CY = 650;
  const RR = 160;
  const nodes = Array.from({ length: 7 }, (_, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / 7;
    return [CX + RR * Math.cos(a), CY + RR * Math.sin(a)] as const;
  });
  const read = move(t, L[1]! + 1.2, 0.4);
  const priced = move(t, L[2]! + 0.9, 0.4);
  const agree = move(t, L[3]! + 0.05, 0.6);
  const hand = ((t - fire) / 30) * 360;
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.accent} x={56} y={52} strength={0.11} />
      <Drift to={1.025} over={13}>
        <div style={{ position: "absolute", left: 70, top: 56 }}>
          <Label color={C.ink3} size={24}>
            The sentinel · cre/unison/workflows/sentinel
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 86, lineHeight: 1.05, marginTop: 10 }}>
            <Words text="Every 30 seconds, a second opinion." at={L[0]!} stagger={0.07} dur={0.5} />
          </div>
        </div>
        {/* the cron: a dial whose hand reaches the top as the workflow fires */}
        <div style={{ position: "absolute", left: 1690 - 100, top: 230 - 100, width: 200, height: 200, opacity: move(t, L[0]!, 0.5) }}>
          <svg width={200} height={200}>
            <circle cx={100} cy={100} r={92} fill={C.raised} stroke={t > fire && t < fire + 0.8 ? C.champagne : C.lineStrong} strokeWidth={2.5} />
            {Array.from({ length: 30 }, (_, k) => {
              const a = (k / 30) * 2 * Math.PI;
              const r0 = k % 5 ? 80 : 72;
              return <line key={k} x1={100 + r0 * Math.sin(a)} y1={100 - r0 * Math.cos(a)} x2={100 + 86 * Math.sin(a)} y2={100 - 86 * Math.cos(a)} stroke={C.ink3} strokeWidth={k % 5 ? 1.2 : 2.4} />;
            })}
            <line x1={100} y1={100} x2={100 + 70 * Math.sin((hand * Math.PI) / 180)} y2={100 - 70 * Math.cos((hand * Math.PI) / 180)} stroke={C.champagne} strokeWidth={4} strokeLinecap="round" />
            <circle cx={100} cy={100} r={7} fill={C.champagne} />
          </svg>
        </div>
        <Ring at={fire} x={1690} y={230} size={420} />
        <div style={{ position: "absolute", left: 1490, width: 400, top: 344, textAlign: "center", opacity: move(t, L[0]! + 0.2, 0.5) }}>
          <div style={{ fontFamily: F.mono, fontSize: 26, color: C.champagne }}>*/30 * * * * *</div>
          <div style={{ fontFamily: F.text, fontSize: 22, color: C.ink3, marginTop: 4 }}>a cron trigger, every 30 s</div>
        </div>
        <Flow x0={1610} y0={290} x1={CX + 110} y1={CY - RR - 20} at={fire} color={C.champagne} />
        {/* where each node looks */}
        <NodeBox x={70} y={300} w={560} h={190} title="Monad mainnet" sub={<span style={{ fontFamily: F.mono, fontSize: 21 }}>ChainlinkCausalReference.latest: the feed's price, and when Chainlink observed it</span>} at={L[1]! + 0.2} lit={L[1]! + 0.5} color={C.accent} />
        <NodeBox x={70} y={530} w={560} h={150} title="Coinbase" sub={<span style={{ fontFamily: F.mono, fontSize: 22 }}>MON-USD ticker</span>} at={L[2]!} lit={L[2]! + 0.2} color={C.buy} />
        <NodeBox x={70} y={720} w={560} h={150} title="Kraken" sub={<span style={{ fontFamily: F.mono, fontSize: 22 }}>MONUSD ticker</span>} at={L[2]! + 0.25} lit={L[2]! + 0.45} color={C.buy} />
        <Flow x0={634} y0={395} x1={CX - RR - 42} y1={CY - 70} at={L[1]! + 0.55} color={C.accent} />
        <Flow x0={634} y0={605} x1={CX - RR - 42} y1={CY + 4} at={L[2]! + 0.35} color={C.buy} />
        <Flow x0={634} y0={795} x1={CX - RR - 42} y1={CY + 70} at={L[2]! + 0.6} color={C.buy} />
        {/* the network: every node runs the same workflow, then they agree */}
        <div style={{ position: "absolute", left: CX - 300, width: 600, top: CY + RR + 52, textAlign: "center", opacity: move(t, L[1]!, 0.5) }}>
          <Label color={C.ink2} size={22}>
            Each node of Chainlink's network
          </Label>
        </div>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {nodes.map(([nx, ny], k) => (
            <line key={k} x1={nx} y1={ny} x2={nx + (CX - nx) * agree} y2={ny + (CY - ny) * agree} stroke={C.champagne} strokeWidth={2.5} opacity={agree > 0 ? 0.8 : 0} />
          ))}
        </svg>
        {nodes.map(([nx, ny], k) => {
          const e = move(t, L[1]! + 0.1 + k * 0.08, 0.4);
          return (
            <div key={k} style={{ position: "absolute", left: nx - 34, top: ny - 34, width: 68, height: 68, borderRadius: 34, background: `radial-gradient(circle at 40% 35%, ${C.raised}, ${C.sunken})`, border: `2px solid color-mix(in oklch, ${C.accent} ${30 + 50 * read}%, transparent)`, boxShadow: read > 0 ? glow(C.accent, 0.3 * read) : undefined, opacity: e, transform: `scale(${0.6 + 0.4 * e})`, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <div style={{ width: 13, height: 13, borderRadius: 7, background: C.accent, opacity: read, boxShadow: glow(C.accent, 0.5) }} />
              <div style={{ width: 13, height: 13, borderRadius: 7, background: C.buy, opacity: priced, boxShadow: glow(C.buy, 0.5) }} />
            </div>
          );
        })}
        <div style={{ position: "absolute", left: CX - 40, top: CY - 40, width: 80, height: 80, borderRadius: 40, background: C.champagne, boxShadow: glow(C.champagne, 1), opacity: clamp01(agree * 2 - 1), transform: `scale(${agree >= 1 ? Math.max(0.6, pop(t, L[3]! + 0.65, 0.45)) : 0.6})`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.text, fontWeight: 600, fontSize: 16, color: C.deep, letterSpacing: "0.08em" }}>
          MEDIAN
        </div>
        <Flow x0={CX + RR + 44} y0={CY} x1={1396} y1={CY} at={L[3]! + 0.55} color={C.champagne} />
        <Card x={1410} y={540} w={450} at={L[3]! + 0.85} label="Consensus" big="one median" note="the market the feed is judged against" color={C.champagne} size={68} />
      </Drift>
      <Narration lines={said("cre-02", L).slice(1)} size={44} bottom={40} accent={{ Coinbase: C.buy, Kraken: C.buy, median: C.champagne }} />
    </AbsoluteFill>
  );
};

// the sentinel's rule (sentinelDecision) and the cases its unit tests hold it to (cre/unison/test/logic.test.ts)
const DEV = 75;
const SILENT = 120;

export const CreRule = () => {
  const t = useT();
  const L = [0.54, 3.92, 5.63, 9.31].map((d, i) => useLine("cre-03", i, d));
  const far = move(t, L[0]! + 0.6, 0.5);
  const quiet = move(t, L[1]! - 0.05, 0.5);
  const halt = L[1]! + 0.7;
  const cell = (x: number, y: number, on: number, color: string, verdict: string, note: string, at: number, test: boolean) => {
    const e = move(t, at, 0.45);
    return (
      <div key={`${x}-${y}`} style={{ position: "absolute", left: x, top: y, width: 660, height: 232, borderRadius: 26, boxSizing: "border-box", padding: "26px 32px", background: `linear-gradient(150deg, color-mix(in oklch, ${color} ${6 + 16 * on}%, ${C.raised}), ${C.sunken})`, border: `2px solid color-mix(in oklch, ${color} ${16 + 60 * on}%, transparent)`, boxShadow: on > 0.5 ? glow(color, 0.4 * on) : undefined }}>
        <div style={{ fontFamily: F.display, fontSize: verdict === "HALT" ? 96 : 62, lineHeight: 1, color: on > 0.5 ? color : C.ink3, opacity: 0.25 + 0.75 * e, textShadow: on > 0.5 ? glow(color, 0.5) : undefined, transform: verdict === "HALT" && t > halt ? `scale(${Math.max(0.6, pop(t, halt, 0.5))})` : undefined, transformOrigin: "0 60%" }}>{verdict}</div>
        <div style={{ fontFamily: F.text, fontSize: 27, color: C.ink, marginTop: 18, opacity: e }}>{note}</div>
        <div style={{ fontFamily: F.text, fontSize: 21, color: C.ink3, marginTop: 6, opacity: e }}>{test ? "a unit test of the sentinel" : "mainnet, 7 October 2026, in Chainlink's simulator"}</div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.sell} x={70} y={70} strength={0.05 + 0.1 * move(t, halt, 0.4)} fill={C.accent} />
      <Drift to={1.025} over={13}>
        <div style={{ position: "absolute", left: 70, top: 50 }}>
          <Label color={C.ink3} size={24}>
            The rule · sentinelDecision
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 84, lineHeight: 1.05, marginTop: 8 }}>
            <Words text="Far off, and silent. Both." at={0.15} stagger={0.08} dur={0.5} />
          </div>
        </div>
        {/* the columns: how far the feed is from the exchanges */}
        {[
          { x: 480, title: "Near the market", sub: `within ${DEV} bp of the exchanges`, on: 0 },
          { x: 1170, title: "Far from the market", sub: `more than ${DEV} bp off`, on: far },
        ].map((c) => (
          <div key={c.title} style={{ position: "absolute", left: c.x, top: 226, width: 660, opacity: move(t, 0.4, 0.5) }}>
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 30, color: c.on > 0.5 ? C.sell : C.ink }}>{c.title}</div>
            <div style={{ fontFamily: F.text, fontSize: 23, color: C.ink3, marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
        {/* the rows: how long since Chainlink last observed */}
        {[
          { y: 330, title: "Speaking", sub: `observed within ${SILENT} s`, on: 0 },
          { y: 584, title: "Silent", sub: `nothing for more than ${SILENT} s`, on: quiet },
        ].map((r) => (
          <div key={r.title} style={{ position: "absolute", left: 70, top: r.y + 70, width: 380, opacity: move(t, 0.5, 0.5) }}>
            <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 32, color: r.on > 0.5 ? C.sell : C.ink }}>{r.title}</div>
            <div style={{ fontFamily: F.text, fontSize: 23, color: C.ink3, marginTop: 4 }}>{r.sub}</div>
          </div>
        ))}
        {cell(480, 330, move(t, L[3]! + 0.3, 0.4), C.accent, "keeps trading", "14 bp off, observed 16 s ago", L[3]! + 0.3, false)}
        {cell(1170, 330, move(t, L[2]! + 0.2, 0.4), C.buy, "keeps trading", "a fast move: 148 bp off, observed 8 s ago", L[2]! + 0.2, true)}
        {cell(480, 584, move(t, L[3]! + 0.55, 0.4), C.buy, "keeps trading", "a quiet feed: 2 bp off, silent for 50 min", L[3]! + 0.55, true)}
        {cell(1170, 584, move(t, halt, 0.3), C.sell, "HALT", "stuck: 148 bp off, silent for 5 min", halt, true)}
        <Ring at={L[3]! + 0.05} x={1500} y={446} size={760} color={C.buy} />
        <Flash at={halt} peak={0.12} color={C.sell} />
      </Drift>
      <Narration lines={said("cre-03", L)} size={46} bottom={44} accent={{ far: C.sell, quiet: C.sell, keep: C.buy, trading: C.buy }} />
    </AbsoluteFill>
  );
};

// the CRE CLI's own output, 7 October 2026 02:26 UTC (src/data/cre-sim.txt)
const SIM = {
  production: {
    cmd: "cre workflow simulate unison/workflows/sentinel --target production-settings --non-interactive --trigger-index 0",
    log: "2026-10-07T02:26:41Z [USER LOG] MON: Chainlink round 18446744073710161055 at 27045 (observed 16 s ago) vs exchanges 27007 → 14 bp",
    result: '"MON:ok:14bp:16s"',
  },
  demo: {
    cmd: "cre workflow simulate unison/workflows/sentinel --target demo-settings --non-interactive --trigger-index 0",
    log: "2026-10-07T02:26:49Z [USER LOG] MON: Chainlink round 18446744073710161055 at 27045 (observed 25 s ago) vs exchanges 27007 → 14 bp",
    result: '"MON:HALT:14bp:25s"',
  },
};

export const CreSim = () => {
  const t = useT();
  const L = [0.48, 3.61, 5.7, 7.66, 9.06, 11.01].map((d, i) => useLine("cre-04", i, d));
  const zero = L[4]! + 0.3;
  const halt = L[5]! + 0.5;
  const lines: TermLine[] = [
    { at: L[0]! - 0.1, kind: "cmd", text: SIM.production.cmd },
    { at: L[0]! + 1.35, kind: "dim", text: "✓ Workflow compiled" },
    { at: L[0]! + 1.7, kind: "dim", text: "2026-10-07T02:26:39Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0" },
    { at: L[1]! - 0.15, kind: "out", text: SIM.production.log },
    { at: L[3]! - 0.2, kind: "dim", text: "✓ Workflow Simulation Result:" },
    { at: L[3]!, kind: "pass", text: SIM.production.result },
    { at: L[4]! - 0.35, kind: "cmd", text: SIM.demo.cmd },
    { at: L[4]! + 1.05, kind: "dim", text: "✓ Workflow compiled" },
    { at: L[5]! - 0.3, kind: "out", text: SIM.demo.log },
    { at: halt - 0.15, kind: "dim", text: "✓ Workflow Simulation Result:" },
    { at: halt, kind: "fail", text: SIM.demo.result },
  ];
  const ok = t >= L[3]! && t < zero;
  const halted = t >= halt;
  const readout = (label: string, value: string, limit: string, newLimit: string, at: number, over: boolean) => (
    <div style={{ opacity: move(t, at - 0.1, 0.4) }}>
      <Label color={C.ink3} size={22}>
        {label}
      </Label>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
        <div style={{ fontFamily: F.display, fontSize: 132, lineHeight: 1.05, color: over ? C.sell : C.ink, textShadow: glow(over ? C.sell : C.accent, 0.5), transform: `scale(${t > at ? Math.max(0.7, pop(t, at, 0.45)) : 0.7})`, transformOrigin: "0 70%" }}>{value}</div>
        <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink3 }}>
          halts above{" "}
          <span style={{ textDecoration: t > zero ? "line-through" : undefined, color: t > zero ? C.ink3 : C.ink2 }}>{limit}</span>
          {t > zero ? <span style={{ color: C.sell, fontWeight: 600, marginLeft: 10, opacity: move(t, zero, 0.3) }}>{newLimit}</span> : null}
        </div>
      </div>
    </div>
  );
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={halted ? C.sell : ok ? C.buy : C.accent} x={76} y={58} strength={0.12} />
      <Drift to={1.02} over={16}>
        <div style={{ position: "absolute", left: 70, top: 50 }}>
          <Label color={C.accent} size={24}>
            Chainlink's CRE simulator · Monad mainnet · 7 October 2026, 02:26 UTC
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 84, lineHeight: 1.05, marginTop: 8 }}>
            <Words text="Keep trading. Or halt." at={0.15} stagger={0.09} dur={0.5} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 70, top: 236, opacity: move(t, 0.2, 0.5) }}>
          <Terminal title="cre · CRE CLI v1.36.0" lines={lines} width={1020} fontSize={19} typeCps={95} maxLines={16} />
        </div>
        <div style={{ position: "absolute", left: 1150, top: 236, width: 710, display: "flex", flexDirection: "column", gap: 26 }}>
          {readout("The feed vs the exchanges", "14 bp", `${DEV} bp`, "0", L[1]!, t > zero)}
          {readout("Since Chainlink observed", t > L[5]! - 0.3 ? "25 s" : "16 s", `${SILENT} s`, "0", L[2]!, t > zero)}
        </div>
        {/* the verdict, as the simulator printed it */}
        <div style={{ position: "absolute", left: 1150, top: 770, width: 710, height: 200 }}>
          {t >= L[3]! ? (
            <div style={{ position: "absolute", inset: 0, opacity: 1 - move(t, zero - 0.1, 0.3), transform: `scale(${Math.max(0.6, pop(t, L[3]!, 0.5))})`, transformOrigin: "0 50%" }}>
              <div style={{ display: "inline-block", fontFamily: F.wide, fontWeight: 600, fontSize: 64, letterSpacing: "0.04em", color: C.deep, background: C.buy, padding: "10px 28px", borderRadius: 18, boxShadow: glow(C.buy, 0.8) }}>KEEP TRADING</div>
              <div style={{ fontFamily: F.mono, fontSize: 28, color: C.buy, marginTop: 14 }}>MON:ok:14bp:16s</div>
            </div>
          ) : null}
          {halted ? (
            <div style={{ position: "absolute", inset: 0, transform: `scale(${Math.max(0.6, pop(t, halt, 0.5))}) rotate(-2deg)`, transformOrigin: "0 50%" }}>
              <div style={{ display: "inline-block", fontFamily: F.wide, fontWeight: 600, fontSize: 64, letterSpacing: "0.04em", color: C.ink, background: C.sell, padding: "10px 28px", borderRadius: 18, boxShadow: glow(C.sell, 0.9) }}>HALT</div>
              <div style={{ fontFamily: F.mono, fontSize: 28, color: C.sell, marginTop: 14 }}>MON:HALT:14bp:25s</div>
              <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink2, marginTop: 6 }}>a halt report, for our receiver contract</div>
            </div>
          ) : null}
        </div>
        <Flash at={halt} peak={0.14} color={C.sell} />
        <div style={{ position: "absolute", left: 70, bottom: 40, fontFamily: F.text, fontSize: 23, color: C.ink3, opacity: move(t, zero, 0.5) }}>
          demo-settings: the same code and the same mainnet reads, with both thresholds set to zero to show the halt path
        </div>
      </Drift>
    </AbsoluteFill>
  );
};

export const CreClose = () => {
  const t = useT();
  const L = [0.53, 2.82, 6.62].map((d, i) => useLine("cre-05", i, d));
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={30} y={60} strength={0.1 + 0.08 * move(t, L[2]!, 0.6)} />
      <Drift to={1.035} over={10}>
        <NodeBox x={70} y={80} w={500} h={170} title="The sentinel's report" sub={<span style={{ fontFamily: F.mono, fontSize: 21 }}>KIND_HALT · market 1 · &quot;feed 14bp off, 25s silent&quot;</span>} at={0.1} lit={L[0]!} color={C.champagne} />
        <Flow x0={574} y0={165} x1={700} y1={165} at={L[0]! + 0.25} color={C.champagne} />
        <NodeBox x={710} y={80} w={540} h={170} title="CREAuditReceiver" sub="takes reports only from Chainlink's forwarder and this workflow; calls setHalt" at={0.3} lit={L[0]! + 0.45} color={C.accent} />
        <Flow x0={1254} y0={165} x1={1380} y1={165} at={L[0]! + 0.7} color={C.accent} />
        <NodeBox x={1390} y={80} w={460} h={170} title="The exchange" sub="halted" at={0.5} lit={L[1]!} color={C.sell} />
        <div style={{ position: "absolute", left: 70, top: 360, fontFamily: F.display, fontSize: 124, lineHeight: 1, textShadow: glow(C.champagne, 0.35) }}>
          <Words text="A halt moves no funds." at={L[0]!} stagger={0.09} dur={0.5} />
        </div>
        <div style={{ position: "absolute", left: 70, top: 530, fontFamily: F.display, fontSize: 64, lineHeight: 1.1, color: C.ink2 }}>
          <Words text="The next auction trades nothing, and returns every order." at={L[1]!} stagger={0.06} dur={0.45} />
        </div>
        <div style={{ position: "absolute", left: 70, top: 690, fontFamily: F.display, fontSize: 92, color: C.champagne, textShadow: glow(C.champagne, 0.9) }}>
          <Sweep at={L[2]! + 1.1}>
            <Words text="Lifting it stays with the guardian." at={L[2]!} stagger={0.08} dur={0.5} />
          </Sweep>
        </div>
        <Ring at={L[2]!} x={760} y={745} size={1300} />
        <div style={{ position: "absolute", left: 70, bottom: 56, fontFamily: F.text, fontSize: 23, color: C.ink3, opacity: move(t, L[2]! + 0.8, 0.6) }}>
          Runs in Chainlink&apos;s simulator against mainnet today; a live DON needs CRE deploy access, still in early access. docs/evidence/cre.md
        </div>
      </Drift>
    </AbsoluteFill>
  );
};
