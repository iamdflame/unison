import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, F, s } from "../../brand";
import live from "../../data/mm-live.json";
import { Arrow, Head, Node, ramp } from "../../kit/Diagram";
import { useLine } from "../../kit/Plan";
import { type TermLine, Terminal } from "../../kit/Terminal";

/**
 * The MetaMask Agent Wallet plugin's video (mm-01 … mm-06). Every terminal line is the real output of
 * mm-plugin-unison 0.1.2 on Monad mainnet, 7 October 2026 (src/data/mm-live.json, run 5 of
 * docs/evidence/agent-wallet.md; the challenge scores from src/data/mm-session.txt). Long transaction links are
 * shortened with an ellipsis; nothing else is changed.
 */
const short = (line: string) => line.replace(/(https:\/\/monadvision\.com\/tx\/0x[0-9a-f]{6})[0-9a-f]{52}([0-9a-f]{6})/g, "$1…$2");
const step = (prefix: string) => {
  const st = live.steps.find((x) => x.command.startsWith(prefix));
  if (!st) throw new Error(`no step ${prefix} in mm-live.json`);
  const progress = ((st as { progress?: string }).progress ?? "").split("\n").filter(Boolean).map(short);
  let hint = "";
  try {
    hint = (JSON.parse(st.output) as { hint?: string }).hint ?? "";
  } catch {
    // a failed step prints its error as JSON too; none of the film's steps failed
  }
  return { command: st.command.replace(/^mm /, "mm "), progress, hint: hint.split("\n") };
};
const kindOf = (line: string): TermLine["kind"] => (line.startsWith("Intent:") ? "intent" : line.trimStart().startsWith("✓") || line.startsWith("Receipt:") || line.startsWith("PASS") ? "pass" : line.trimStart().startsWith("waiting") ? "dim" : "out");

const MARKETS = step("mm unison markets");
const QUOTE = step("mm unison quote");
const ORDER = step("mm unison order");
const RECEIPT = step("mm unison receipt");
const INTENT = ORDER.progress.find((l) => l.startsWith("Intent:"))!.replace("Intent: ", "");
/** read with `mm unison challenge score` on 7 October, 00:50 UTC (src/data/mm-session.txt) */
const SNIPER = "0xcEc80166Ab48cb3C4ebD98671524761b1fd81276";
const SCORE_OLD = "9 of 30 counted fills, edge 14.15 bp (0.001103 AUSD); the pot pays above 2 bp. Not yet. Pot: 1 AUSD.";
const SCORE_UNISON = "9 of 30 counted fills, edge -18.59 bp (0.001447 AUSD lost); the pot pays above 2 bp. Not yet. Pot: 18 AUSD.";
const COMMANDS = ["markets", "quote", "balance", "deposit", "order", "receipt", "claim", "withdraw", "challenge open", "challenge fund", "challenge order", "challenge settle", "challenge score", "challenge claim", "challenge withdraw"];

export const MmTitle = () => {
  const t = useCurrentFrame() / s(1);
  const at = [useLine("mm-01", 0, 0.3), useLine("mm-01", 1, 2.2), useLine("mm-01", 2, 4.4), useLine("mm-01", 3, 5.6)];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <div style={{ position: "absolute", left: 140, top: 210 }}>
        <div style={{ fontFamily: F.text, fontSize: 26, letterSpacing: "0.16em", color: C.ink2, opacity: ramp(t, at[3]! - 0.2, at[3]! + 0.6) }}>A PLUGIN FOR METAMASK&apos;S AGENT WALLET</div>
        <div style={{ fontFamily: F.mono, fontSize: 112, marginTop: 18, opacity: ramp(t, at[0]! - 0.2, at[0]! + 0.6) }}>mm-plugin-unison</div>
        <div style={{ fontFamily: F.display, fontSize: 64, color: C.ink, marginTop: 26, opacity: ramp(t, at[1]! - 0.1, at[1]! + 0.7) }}>An AI agent trades on Unison,</div>
        <div style={{ fontFamily: F.display, fontSize: 64, color: C.champagne, marginTop: 6, opacity: ramp(t, at[2]! - 0.1, at[2]! + 0.7) }}>live on Monad mainnet.</div>
      </div>
      <div style={{ position: "absolute", left: 140, right: 140, bottom: 120, display: "flex", flexWrap: "wrap", gap: 12, opacity: ramp(t, at[3]! + 0.4, at[3]! + 1.4) }}>
        {COMMANDS.map((c, i) => (
          <div key={c} style={{ fontFamily: F.mono, fontSize: 22, color: i < 8 ? C.ink2 : C.accent, padding: "8px 14px", borderRadius: 10, boxShadow: `0 0 0 1px ${C.lineStrong}`, opacity: ramp(t, at[3]! + 0.4 + i * 0.05, at[3]! + 0.9 + i * 0.05) }}>
            mm unison {c}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const MmKeys = () => {
  const t = useCurrentFrame() / s(1);
  const at = [useLine("mm-02", 0, 0.3), useLine("mm-02", 1, 2.4), useLine("mm-02", 2, 5.4), useLine("mm-02", 3, 8.0)];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="WHO SIGNS" title="The plugin never holds a key." show={ramp(t, at[0]! - 0.3, at[0]! + 0.5)} />
      <Node x={140} y={330} w={300} title="Your agent" sub="mm unison order WMON sell 10" show={ramp(t, 0.2, 1.0)} />
      <Arrow x0={450} x1={600} y={400} label="a command" show={ramp(t, 0.8, 1.4)} />
      <Node x={610} y={330} w={330} title="mm-plugin-unison" sub="plans the order, encodes the call; holds no key" show={ramp(t, 1.0, 1.8)} color={C.accent} />
      <Arrow x0={950} x1={1110} y={400} label="call + intent" show={ramp(t, at[1]! + 0.3, at[1]! + 1.0)} color={C.accent} />
      <Node x={1120} y={330} w={360} title="MetaMask Agent Wallet" sub="shows the intent, then signs with its own key" show={ramp(t, at[1]!, at[1]! + 0.8)} color={C.champagne} />
      <Arrow x0={1490} x1={1640} y={400} label="signed" show={ramp(t, at[2]! + 1.6, at[2]! + 2.2)} color={C.champagne} />
      <Node x={1650} y={330} w={170} title="Monad" sub="mainnet, 143" show={ramp(t, at[2]! + 1.8, at[2]! + 2.6)} />
      {/* the intent line, as the wallet showed it on 7 October */}
      <div style={{ position: "absolute", left: 1120, right: 100, top: 560, opacity: ramp(t, at[2]! - 0.1, at[2]! + 0.7) }}>
        <div style={{ fontFamily: F.text, fontSize: 20, letterSpacing: "0.12em", color: C.ink3 }}>THE INTENT IT SHOWED</div>
        <div style={{ fontFamily: F.mono, fontSize: 23, color: C.accent, marginTop: 10, lineHeight: 1.45 }}>{INTENT}</div>
      </div>
      {/* reads skip the wallet: the plugin asks Monad directly */}
      <div style={{ position: "absolute", left: 610, top: 760, width: 1210, opacity: ramp(t, at[3]! - 0.1, at[3]! + 0.7) }}>
        <div style={{ height: 2, background: `repeating-linear-gradient(to right, ${C.ink3} 0 10px, transparent 10px 18px)` }} />
        <div style={{ fontFamily: F.mono, fontSize: 20, color: C.ink3, marginTop: 12 }}>reads go straight to Monad: prices, balances, Chainlink&apos;s rounds</div>
      </div>
    </AbsoluteFill>
  );
};

export const MmSale = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 2.2, 3.7, 5.0, 8.0, 10.2, 12.3].map((d, i) => useLine("mm-03", i, d));
  const lines: TermLine[] = [
    { at: L[1]! - 0.2, kind: "cmd", text: MARKETS.command },
    ...MARKETS.hint.map((h, i) => ({ at: L[1]! + 0.9 + i * 0.15, kind: "out" as const, text: h })),
    { at: L[2]! - 0.3, kind: "cmd", text: QUOTE.command },
    { at: L[2]! + 1.0, kind: "out", text: QUOTE.hint[0]! },
    { at: L[3]! - 0.2, kind: "cmd", text: ORDER.command },
    ...ORDER.progress.map((p) => {
      // each line on the words that describe it: signed as "sells ten", sealed on "doesn't exist yet", priced on "Chainlink observes"
      const at = p.startsWith("Intent:")
        ? L[3]! + 1.1
        : p.startsWith("Tx submitted")
          ? L[3]! + 1.5
          : p.trimStart().startsWith("✓")
            ? L[3]! + 1.9
            : p.startsWith("Sealed")
              ? L[4]! - 0.1
              : p.trimStart().startsWith("waiting")
                ? L[4]! + 1.3
                : p.startsWith("Priced")
                  ? L[5]! + 0.9
                  : L[6]! + 0.6;
      return { at, kind: p.startsWith("Tx submitted") ? ("dim" as const) : kindOf(p), text: p };
    }),
    { at: L[6]! + 1.2, kind: "hint", text: ORDER.hint[0]!.replace(/: https:.*$/, "") },
  ];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="MONAD MAINNET · 7 OCTOBER 2026 · A REAL RUN" title="A sealed sale, priced after the seal." show={ramp(t, 0, 0.7)} />
      <div style={{ position: "absolute", left: 140, top: 270 }}>
        <Terminal title="mm · mm-plugin-unison 0.1.2" lines={lines} width={1640} fontSize={21} typeCps={60} maxLines={15} />
      </div>
    </AbsoluteFill>
  );
};

export const MmReceipt = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 2.4, 3.6, 6.0, 7.0].map((d, i) => useLine("mm-04", i, d));
  const passes = RECEIPT.hint.filter((h) => h.startsWith("PASS"));
  const verified = RECEIPT.hint.find((h) => h.startsWith("Verified"))!.replace(/ https:.*$/, "");
  const span = Math.max(0.3, (L[3]! - 0.3 - (L[1]! + 0.4)) / passes.length);
  const lines: TermLine[] = [
    { at: L[0]! - 0.2, kind: "cmd", text: RECEIPT.command },
    ...passes.map((p, i) => ({ at: L[1]! + 0.4 + i * span, kind: "pass" as const, text: p })),
    { at: L[3]!, kind: "hint", text: verified },
  ];
  const n = lines.filter((l) => l.kind === "pass" && t >= l.at).length;
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="FROM THE CHAIN ALONE" title="The agent checks its own receipt." show={ramp(t, 0, 0.7)} />
      <div style={{ position: "absolute", left: 140, top: 270 }}>
        <Terminal title="mm · mm-plugin-unison 0.1.2" lines={lines} width={1640} fontSize={21} typeCps={70} maxLines={12} />
      </div>
      <div style={{ position: "absolute", right: 140, bottom: 80, fontFamily: F.display, fontSize: 72, color: n === 6 ? C.buy : C.ink3 }}>
        {n} <span style={{ fontFamily: F.text, fontSize: 32 }}>of 6</span>
      </div>
    </AbsoluteFill>
  );
};

export const MmChallenge = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 3.0, 4.6, 8.6, 10.0, 11.4].map((d, i) => useLine("mm-05", i, d));
  const sniper = `${SNIPER.slice(0, 6)}…${SNIPER.slice(-4)}`;
  const lines: TermLine[] = [
    { at: L[3]! - 0.3, kind: "cmd", text: `mm unison challenge score --rule old --address ${sniper}` },
    { at: L[4]! + 0.2, kind: "out", text: SCORE_OLD },
    { at: L[4]! + 1.0, kind: "cmd", text: `mm unison challenge score --address ${sniper}` },
    { at: L[5]! + 0.3, kind: "out", text: SCORE_UNISON },
  ];
  const steps = ["open", "fund", "order", "settle", "score", "claim"];
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      <Head eyebrow="THE STANDING CHALLENGE" title="Agents can try to snipe us." show={ramp(t, L[0]! - 0.3, L[0]! + 0.5)} />
      <div style={{ position: "absolute", left: 140, top: 250, display: "flex", gap: 14, opacity: ramp(t, L[1]! - 0.2, L[1]! + 0.6) }}>
        {steps.map((x, i) => (
          <div key={x} style={{ fontFamily: F.mono, fontSize: 24, color: x === "score" ? C.champagne : C.ink2, padding: "10px 16px", borderRadius: 10, boxShadow: `0 0 0 1px ${C.lineStrong}`, opacity: ramp(t, L[1]! + i * 0.25, L[1]! + 0.5 + i * 0.25) }}>
            challenge {x}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 140, top: 340, fontFamily: F.text, fontSize: 28, color: C.ink2, maxWidth: 1400, opacity: ramp(t, L[2]! - 0.1, L[2]! + 0.7) }}>
        A contract marks every fill against Chainlink&apos;s price 60 s later, and pays the pot above +2 bp over 30 fills.
      </div>
      <div style={{ position: "absolute", left: 140, top: 450, opacity: ramp(t, L[3]! - 0.8, L[3]! - 0.2) }}>
        <Terminal title="mm · the house sniper, on both rules" lines={lines} width={1640} fontSize={22} typeCps={70} maxLines={6} />
      </div>
      <div style={{ position: "absolute", left: 140, top: 820, display: "flex", gap: 90 }}>
        <div style={{ opacity: ramp(t, L[4]! + 0.3, L[4]! + 1.0) }}>
          <div style={{ fontFamily: F.text, fontSize: 22, letterSpacing: "0.12em", color: C.sell }}>OLD RULE</div>
          <div style={{ fontFamily: F.display, fontSize: 84, color: C.sell }}>+14.15 bp</div>
        </div>
        <div style={{ opacity: ramp(t, L[5]! + 0.4, L[5]! + 1.1) }}>
          <div style={{ fontFamily: F.text, fontSize: 22, letterSpacing: "0.12em", color: C.accent }}>UNISON</div>
          <div style={{ fontFamily: F.display, fontSize: 84, color: C.accent }}>−18.59 bp</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const MmClose = () => {
  const t = useCurrentFrame() / s(1);
  const L = [0.3, 1.5, 3.0, 5.4, 6.5].map((d, i) => useLine("mm-06", i, d));
  const stats = [
    { n: "15", label: "commands", at: L[0]! },
    { n: "23", label: "unit tests", at: L[1]! },
    { n: "7", label: "tests on a mainnet fork", at: L[2]! },
  ];
  return (
    <AbsoluteFill style={{ background: C.deep, color: C.ink }}>
      <div style={{ position: "absolute", left: 160, top: 210, display: "flex", gap: 120 }}>
        {stats.map((x) => (
          <div key={x.label} style={{ opacity: ramp(t, x.at - 0.1, x.at + 0.6) }}>
            <div style={{ fontFamily: F.display, fontSize: 150, lineHeight: 1 }}>{x.n}</div>
            <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink2, marginTop: 10 }}>{x.label}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 160, top: 560, opacity: ramp(t, L[3]! - 0.2, L[3]! + 0.6) }}>
        <div style={{ fontFamily: F.text, fontSize: 24, letterSpacing: "0.14em", color: C.ink3 }}>INSTALL</div>
        <div style={{ fontFamily: F.mono, fontSize: 30, color: C.ink, marginTop: 16, lineHeight: 1.6 }}>
          <span style={{ color: C.champagne }}>$ </span>pnpm --filter mm-plugin-unison run stage
          <br />
          <span style={{ color: C.champagne }}>$ </span>mm plugins install &quot;file:&lt;the staged path&gt;&quot; --accept-permissions
        </div>
        <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink3, marginTop: 18 }}>github.com/iamdflame/unison · integrations/agent-wallet-plugin</div>
      </div>
      <div style={{ position: "absolute", left: 160, bottom: 110, fontFamily: F.display, fontSize: 64, color: C.champagne, opacity: ramp(t, L[4]! - 0.1, L[4]! + 0.7) }}>Let your agent try to snipe us.</div>
    </AbsoluteFill>
  );
};
