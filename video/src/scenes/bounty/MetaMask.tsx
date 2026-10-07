import { AbsoluteFill } from "remotion";
import { C, F } from "../../brand";
import { CHALLENGE, CHALLENGE_URL } from "../../data/chain";
import live from "../../data/mm-live.json";
import { Backdrop, clamp01, Drift, glow, Label, move, Narration, pop, Ring, Sweep, useT, Words } from "../../kit/Fx";
import { useLine } from "../../kit/Plan";
import { QR } from "../../kit/QR";
import { type TermLine, Terminal } from "../../kit/Terminal";
import { Card, Chip, Flow, NodeBox, Route, said, Stat } from "./parts";

/**
 * The MetaMask Agent Wallet plugin's film (mm-01 … mm-06). Every terminal line is the real output of
 * mm-plugin-unison 0.1.2 on Monad mainnet, 7 October 2026 (src/data/mm-live.json, run 5 of
 * docs/evidence/agent-wallet.md; the challenge scores from src/data/mm-session.txt). Long transaction links are
 * shortened with an ellipsis; nothing else is changed. What each step did is set large beside it as it lands.
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
  return { command: st.command, progress, hint: hint.split("\n") };
};
const kindOf = (line: string): TermLine["kind"] => (line.startsWith("Intent:") ? "intent" : line.trimStart().startsWith("✓") || line.startsWith("Receipt:") || line.startsWith("PASS") ? "pass" : line.trimStart().startsWith("waiting") ? "dim" : "out");

const MARKETS = step("mm unison markets");
const QUOTE = step("mm unison quote");
const ORDER = step("mm unison order");
const RECEIPT = step("mm unison receipt");
const INTENT = ORDER.progress.find((l) => l.startsWith("Intent:"))!.replace("Intent: ", "");
const WMON_LINE = MARKETS.hint.find((h) => h.startsWith("WMON"))!;
const SEALED_BLOCK = Number(ORDER.progress.find((l) => l.startsWith("Sealed"))!.match(/block (\d+)/)![1]);
const PRICED = ORDER.progress.find((l) => l.startsWith("Priced"))!.match(/Priced: ([\d.]+) AUSD.*Chainlink: ([\d.]+)/)!;
// the receipt's own times: sealed at …429, observed at …443
const SEAL_TO_OBSERVED = 14;
/** read with `mm unison challenge score` on 7 October, 00:50 UTC (src/data/mm-session.txt) */
const SNIPER = "0xcEc80166Ab48cb3C4ebD98671524761b1fd81276";
const SCORES = { old: { bps: 14.15, fills: 9 }, unison: { bps: -18.59, fills: 9 } };
const COMMANDS = ["markets", "quote", "balance", "deposit", "order", "receipt", "claim", "withdraw", "challenge open", "challenge fund", "challenge order", "challenge settle", "challenge score", "challenge claim", "challenge withdraw"];

export const MmTitle = () => {
  const t = useT();
  const L = [0.47, 3.34, 5.98, 7.75].map((d, i) => useLine("mm-01", i, d));
  const typed = Math.floor(clamp01((t - 0.15) / 1.0) * "mm-plugin-unison".length);
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.accent} x={50} y={36} strength={0.16} />
      {/* its fifteen commands, drifting behind it */}
      <AbsoluteFill style={{ opacity: 0.16 + 0.1 * move(t, L[3]!, 0.8) }}>
        {COMMANDS.map((c, i) => {
          const row = i % 5;
          const col = Math.floor(i / 5);
          const x = ((col * 640 + row * 170 + t * (18 + row * 4)) % 2300) - 260;
          return (
            <div key={c} style={{ position: "absolute", left: x, top: 90 + row * 196, fontFamily: F.mono, fontSize: 30, color: C.ink2, whiteSpace: "nowrap" }}>
              mm unison {c}
            </div>
          );
        })}
      </AbsoluteFill>
      <Drift to={1.04} over={10}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 286, textAlign: "center" }}>
          <div style={{ opacity: move(t, 0.05, 0.5) }}>
            <Label color={C.champagne} size={32} style={{ letterSpacing: "0.28em" }}>
              A plugin for MetaMask's Agent Wallet
            </Label>
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 136, lineHeight: 1, marginTop: 30, color: C.ink, textShadow: glow(C.accent, 0.8) }}>
            {"mm-plugin-unison".slice(0, typed)}
            <span style={{ opacity: Math.floor(t * 2.4) % 2 ? 1 : 0.15, color: C.accent }}>▍</span>
          </div>
          <div style={{ fontFamily: F.display, fontSize: 82, marginTop: 50 }}>
            <Words text="An AI agent trades on Unison," at={L[1]!} stagger={0.08} dur={0.5} />
          </div>
          <div style={{ fontFamily: F.display, fontSize: 82, color: C.champagne, textShadow: glow(C.champagne, 0.6) }}>
            <Words text="live on Monad mainnet." at={L[2]!} stagger={0.08} dur={0.5} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 110, display: "flex", justifyContent: "center", gap: 24, opacity: move(t, L[3]! + 0.3, 0.6) }}>
          <div style={{ fontFamily: F.mono, fontSize: 36, padding: "16px 28px", borderRadius: 16, background: C.raised, boxShadow: `0 0 0 1.5px ${C.champagne}, ${glow(C.champagne, 0.4)}` }}>
            <span style={{ color: C.champagne }}>$ </span>mm plugins install mm-plugin-unison
          </div>
          <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 30, padding: "18px 24px", borderRadius: 16, color: C.ink2, boxShadow: `0 0 0 1.5px ${C.lineStrong}` }}>npm · v0.1.2</div>
        </div>
      </Drift>
    </AbsoluteFill>
  );
};

export const MmKeys = () => {
  const t = useT();
  const L = [0.53, 2.89, 6.55, 9.79].map((d, i) => useLine("mm-02", i, d));
  const signed = L[2]! + 2.2;
  const y = 300;
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={66} y={30} strength={0.12} />
      <Drift to={1.03} over={12}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center" }}>
          <Label color={C.ink3} size={28}>
            Who signs
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 104, marginTop: 10 }}>
            <Words text="The plugin never holds a key." at={L[0]!} stagger={0.09} dur={0.55} />
          </div>
        </div>
        <NodeBox x={70} y={y} w={360} h={200} title="Your agent" sub={<span style={{ fontFamily: F.mono, fontSize: 22 }}>mm unison order WMON sell 10</span>} at={0.3} lit={L[1]!} color={C.ink2} />
        <Flow x0={432} y0={y + 100} x1={532} y1={y + 100} at={L[1]! + 0.1} color={C.ink2} />
        <NodeBox x={540} y={y} w={400} h={200} title="mm-plugin-unison" sub="plans the order and encodes the call. No key." at={0.6} lit={L[1]! + 0.3} color={C.accent} />
        <Flow x0={942} y0={y + 100} x1={1042} y1={y + 100} at={L[1]! + 0.5} color={C.accent} />
        <NodeBox x={1050} y={y} w={430} h={200} title="MetaMask Agent Wallet" sub="the only one with a key: it shows the intent, then signs" at={L[1]!} lit={L[1]! + 0.7} color={C.champagne} />
        <Flow x0={1482} y0={y + 100} x1={1572} y1={y + 100} at={signed} color={C.champagne} />
        <NodeBox x={1580} y={y} w={270} h={200} title="Monad" sub="mainnet · chain 143" at={signed - 0.2} lit={signed + 0.2} color={C.buy} />
        {/* the intent, as the wallet showed it */}
        <div style={{ position: "absolute", left: 1050, width: 800, top: y + 350, borderRadius: 24, padding: "22px 28px", background: C.raised, boxShadow: `0 0 0 1.5px ${C.accent}, ${glow(C.accent, 0.35)}`, opacity: move(t, L[2]!, 0.5), transform: `translateY(${(1 - move(t, L[2]!, 0.5)) * 20}px)` }}>
          <Label color={C.accent} size={22}>
            The intent it showed, before it signed
          </Label>
          <div style={{ fontFamily: F.mono, fontSize: 27, lineHeight: 1.4, marginTop: 10 }}>{INTENT}</div>
          {t > signed ? (
            <div style={{ position: "absolute", right: 22, top: -30, padding: "8px 18px", borderRadius: 12, background: C.buy, color: C.deep, fontFamily: F.text, fontWeight: 600, fontSize: 28, transform: `scale(${pop(t, signed, 0.45)}) rotate(-4deg)` }}>✓ signed</div>
          ) : null}
        </div>
        {/* reads skip the wallet */}
        <Route points={[[740, y + 202], [740, y + 290], [1715, y + 290], [1715, y + 202]]} at={L[3]! - 0.1} color={C.buy} dashed />
        <div style={{ position: "absolute", left: 120, top: y + 350, width: 860, opacity: move(t, L[3]! + 0.2, 0.5) }}>
          <Label color={C.ink2} size={26}>
            Reads go straight to Monad
          </Label>
          <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink3, marginTop: 8 }}>prices, balances, Chainlink's rounds: no wallet, no signature</div>
        </div>
      </Drift>
      <Narration lines={said("mm-02", L).slice(1)} bottom={54} size={50} accent={{ executor: C.champagne, intent: C.accent, Monad: C.buy }} />
    </AbsoluteFill>
  );
};

export const MmSale = () => {
  const t = useT();
  const L = [0.47, 2.64, 4.24, 5.24, 8.77, 10.83, 13.32].map((d, i) => useLine("mm-03", i, d));
  const term: TermLine[] = [
    { at: L[1]! - 0.2, kind: "cmd", text: MARKETS.command },
    ...MARKETS.hint.map((h, i) => ({ at: L[1]! + 0.7 + i * 0.12, kind: "out" as const, text: h })),
    { at: L[2]! - 0.3, kind: "cmd", text: QUOTE.command },
    { at: L[2]! + 0.6, kind: "out", text: QUOTE.hint[0]! },
    { at: L[3]! - 0.2, kind: "cmd", text: ORDER.command },
    ...ORDER.progress.map((p) => {
      // each line on the words that describe it
      const at = p.startsWith("Intent:") ? L[3]! + 1.1 : p.startsWith("Tx submitted") ? L[3]! + 1.5 : p.trimStart().startsWith("✓") ? L[3]! + 1.9 : p.startsWith("Sealed") ? L[4]! - 0.1 : p.trimStart().startsWith("waiting") ? L[4]! + 1.2 : p.startsWith("Priced") ? L[5]! + 0.9 : L[6]! + 0.6;
      return { at, kind: p.startsWith("Tx submitted") ? ("dim" as const) : kindOf(p), text: p };
    }),
  ];
  const priced = L[5]! + 0.9;
  const wait = clamp01((t - L[4]!) / (priced - L[4]!));
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.accent} x={78} y={30} strength={0.12} />
      <Drift to={1.025} over={17}>
        <div style={{ position: "absolute", left: 70, top: 56 }}>
          <Label color={C.buy} size={26}>
            ● Monad mainnet · 7 October 2026 · a real run
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 86, lineHeight: 1.05, marginTop: 10 }}>
            <Words text="A sealed sale, priced after the seal." at={0.2} stagger={0.07} dur={0.5} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 70, top: 240, opacity: move(t, 0.3, 0.5) }}>
          <Terminal title="mm · mm-plugin-unison 0.1.2" lines={term} width={1010} fontSize={19} typeCps={70} maxLines={17} />
        </div>
        <Card x={1130} y={236} w={720} at={L[1]! + 0.8} label="The market" big={WMON_LINE.split(" (")[0]!.replace("WMON/AUSD: ", "$").replace(" AUSD", "")} note="WMON/AUSD on Chainlink, read straight from Monad" size={58} color={C.ink2} />
        <Card x={1130} y={422} w={720} at={L[2]! + 0.6} label="The quote" big="sell 10 WMON" note={QUOTE.hint[0]!.split("(")[0]!.replace("sell 10 WMON ", "")} size={58} color={C.champagne} />
        <Card x={1130} y={608} w={720} at={L[4]! - 0.1} label={`Sealed · block ${SEALED_BLOCK.toLocaleString("en-US")}`} big="its price doesn't exist yet" size={52} color={C.ink} />
        {/* the wait, between the seal and the price, where the price will land */}
        {t > L[4]! + 0.3 && t < priced + 0.5 ? (
          <div style={{ position: "absolute", left: 1130, top: 812, width: 720, opacity: move(t, L[4]! + 0.3, 0.4) * (1 - clamp01((t - priced) / 0.4)) }}>
            <div style={{ fontFamily: F.text, fontSize: 26, color: C.ink2 }}>waiting for Chainlink&apos;s next observation…</div>
            <div style={{ marginTop: 16, height: 8, borderRadius: 4, background: C.lineStrong }}>
              <div style={{ width: `${wait * 100}%`, height: "100%", borderRadius: 4, background: C.accent, boxShadow: glow(C.accent, 0.7) }} />
            </div>
          </div>
        ) : null}
        <Card x={1130} y={794} w={720} at={priced} label={`Priced · Chainlink observed ${SEAL_TO_OBSERVED} s after the seal`} big={`${PRICED[1]} AUSD`} note={`one price for everyone in the auction · Chainlink ${PRICED[2]}`} size={66} color={C.accent} />
      </Drift>
    </AbsoluteFill>
  );
};

export const MmReceipt = () => {
  const t = useT();
  const L = [0.53, 2.9, 4.4, 7.04, 8.47].map((d, i) => useLine("mm-04", i, d));
  const passes = RECEIPT.hint.filter((h) => h.startsWith("PASS"));
  const verified = RECEIPT.hint.find((h) => h.startsWith("Verified"))!.replace(/ https:.*$/, "");
  const span = Math.max(0.3, (L[3]! - 0.3 - (L[1]! + 0.4)) / passes.length);
  const term: TermLine[] = [
    { at: L[0]! - 0.2, kind: "cmd", text: RECEIPT.command },
    ...passes.map((p, i) => ({ at: L[1]! + 0.4 + i * span, kind: "pass" as const, text: p })),
    { at: L[3]!, kind: "hint", text: verified },
  ];
  const checks = passes.map((p, i) => {
    const text = p.replace(/^PASS\s+/, "");
    const words = text.includes("no earlier observation qualified") ? "no earlier observation qualified" : text.split(/\s*[(:]/)[0]!;
    return { at: L[1]! + 0.4 + i * span, words: words.replace(/block (\d+)/, (_, n: string) => `block ${Number(n).toLocaleString("en-US")}`) };
  });
  const n = checks.filter((c) => t >= c.at).length;
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.buy} x={74} y={30} strength={0.08 + 0.1 * move(t, L[3]!, 0.5)} />
      <Drift to={1.025} over={11}>
        <div style={{ position: "absolute", left: 70, top: 60 }}>
          <Label color={C.ink3} size={26}>
            From the chain alone
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 96, lineHeight: 1.05, marginTop: 10 }}>
            <Words text="The agent checks its own receipt." at={L[0]!} stagger={0.08} dur={0.5} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 70, top: 260, opacity: move(t, 0.3, 0.5) }}>
          <Terminal title="mm · mm-plugin-unison 0.1.2" lines={term} width={1000} fontSize={19} typeCps={80} maxLines={14} />
        </div>
        <div style={{ position: "absolute", left: 1120, top: 270, width: 730 }}>
          {checks.map((c, i) => {
            const on = t >= c.at;
            return (
              <div key={c.at} style={{ display: "flex", alignItems: "center", gap: 24, height: 96, opacity: 0.35 + 0.65 * move(t, c.at - 0.1, 0.3) }}>
                <div style={{ width: 58, height: 58, flex: "none", borderRadius: 29, border: `3px solid ${on ? C.buy : C.lineStrong}`, background: on ? C.buy : "transparent", boxShadow: on ? glow(C.buy, 0.8) : undefined, transform: `scale(${on ? Math.max(0.6, pop(t, c.at, 0.45)) : 1})`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.text, fontWeight: 600, fontSize: 34, color: C.deep }}>{on ? "✓" : i + 1}</div>
                <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 29, lineHeight: 1.18, color: on ? C.ink : C.ink3 }}>{c.words}</div>
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", right: 70, top: 56, textAlign: "right" }}>
          <div style={{ fontFamily: F.display, fontSize: 140, lineHeight: 1, color: n === checks.length ? C.champagne : C.ink3, textShadow: n === checks.length ? glow(C.champagne, 1) : undefined }}>
            <Sweep at={L[3]! + 0.2}>
              {n}/{checks.length}
            </Sweep>
          </div>
        </div>
        {t > L[4]! - 0.1 ? (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, textAlign: "center", fontFamily: F.display, fontSize: 84, color: C.champagne, textShadow: glow(C.champagne, 0.7) }}>
            <Words text="It doesn't have to trust us either." at={L[4]! - 0.05} stagger={0.07} dur={0.5} />
          </div>
        ) : null}
      </Drift>
    </AbsoluteFill>
  );
};

export const MmChallenge = () => {
  const t = useT();
  const L = [0.52, 3.33, 5.53, 9.49, 11.02, 12.54].map((d, i) => useLine("mm-05", i, d));
  const steps = ["challenge open", "challenge fund", "challenge order", "challenge score", "challenge claim"];
  const sniper = `${SNIPER.slice(0, 6)}…${SNIPER.slice(-4)}`;
  const bar = (bps: number, at: number) => move(t, at, 0.9) * bps;
  // a diverging chart: a win runs right of zero, a loss left
  const ZERO = 780;
  const PX_BP = 30;
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={50} y={18} strength={0.11} fill={C.sell} />
      <Drift to={1.03} over={15}>
        <div style={{ position: "absolute", left: 70, top: 56 }}>
          <Label color={C.champagne} size={28}>
            The standing challenge
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 96, lineHeight: 1.05, marginTop: 10 }}>
            <Words text="Agents can try to snipe us, too." at={L[0]!} stagger={0.08} dur={0.5} />
          </div>
        </div>
        <div style={{ position: "absolute", right: 70, top: 60, textAlign: "right" }}>
          <Label color={C.ink3} size={24}>
            The pot
          </Label>
          <div style={{ fontFamily: F.display, fontSize: 92, color: C.champagne, textShadow: glow(C.champagne, 0.6) }}>{CHALLENGE.pots.causal}</div>
        </div>
        {/* the commands, in the order an agent runs them */}
        <div style={{ position: "absolute", left: 70, top: 250, display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ fontFamily: F.mono, fontSize: 25, color: C.ink3, opacity: move(t, L[1]! - 0.1, 0.4) }}>mm unison</div>
          {steps.map((x, i) => (
            <div key={x} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Chip text={x} at={L[1]! + i * 0.28} lit={x === "challenge score" && t > L[3]! - 0.3} size={25} />
              {i < steps.length - 1 ? <div style={{ color: C.ink3, fontSize: 30, opacity: move(t, L[1]! + i * 0.28 + 0.2, 0.3) }}>→</div> : null}
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", left: 70, top: 346, fontFamily: F.text, fontSize: 32, lineHeight: 1.3, color: C.ink2, maxWidth: 1760, opacity: move(t, L[2]!, 0.5) }}>
          A contract marks each fill to <span style={{ color: C.accent }}>Chainlink&apos;s first observation 60 s after the order</span>. Average more than <span style={{ color: C.champagne }}>+2 bp after fees over 30 fills</span>, and the pot pays.
        </div>
        {/* the house sniper's score on each rule, from `mm unison challenge score` */}
        <div style={{ position: "absolute", left: 70, top: 470, fontFamily: F.mono, fontSize: 24, color: C.ink3, opacity: move(t, L[3]! - 0.2, 0.5) }}>
          <span style={{ color: C.champagne }}>$ </span>mm unison challenge score --address {sniper} · 7 Oct 2026, 00:50 UTC
        </div>
        <div style={{ position: "absolute", left: ZERO - 1, top: 540, width: 2, height: 420, background: C.lineStrong, opacity: move(t, L[2]! + 0.4, 0.5) }} />
        <div style={{ position: "absolute", left: ZERO - 200, width: 400, top: 968, textAlign: "center", fontFamily: F.text, fontSize: 22, color: C.ink3, opacity: move(t, L[2]! + 0.4, 0.5) }}>0 bp: a fair fill</div>
        {[
          { at: L[4]!, label: "Our sniper on the old rule · it wins", bps: SCORES.old.bps, fills: SCORES.old.fills, color: C.sell },
          { at: L[5]!, label: "Our sniper on Unison · it loses", bps: SCORES.unison.bps, fills: SCORES.unison.fills, color: C.accent },
        ].map((r, i) => {
          const v = bar(r.bps, r.at);
          return (
            <div key={r.label} style={{ position: "absolute", left: 0, top: 556 + i * 200, width: 1920, height: 190, opacity: 0.3 * move(t, L[2]! + 0.5 + i * 0.2, 0.5) + 0.7 * move(t, r.at - 0.1, 0.4) }}>
              <div style={{ position: "absolute", left: 70 }}>
                <Label color={r.color} size={24}>
                  {r.label} · {r.fills} of 30 fills so far
                </Label>
              </div>
              <div style={{ position: "absolute", top: 50, height: 84, borderRadius: 14, left: v >= 0 ? ZERO : ZERO + v * PX_BP, width: Math.abs(v) * PX_BP, background: `linear-gradient(90deg, color-mix(in oklch, ${r.color} 70%, black), ${r.color})`, boxShadow: glow(r.color, 0.6) }} />
              <div style={{ position: "absolute", left: 1270, top: 24, fontFamily: F.display, fontSize: 110, lineHeight: 1, color: r.color, textShadow: glow(r.color, 0.7), opacity: move(t, r.at - 0.1, 0.3) }}>
                {r.bps > 0 ? "+" : "−"}
                {Math.abs(v).toFixed(2)} bp
              </div>
            </div>
          );
        })}
      </Drift>
    </AbsoluteFill>
  );
};

export const MmClose = () => {
  const t = useT();
  const L = [0.58, 1.95, 3.4, 5.97, 6.95].map((d, i) => useLine("mm-06", i, d));
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={40} y={30} strength={0.14} />
      <Drift to={1.035} over={10}>
        <div style={{ position: "absolute", left: 120, top: 80, display: "flex", gap: 210 }}>
          <Stat n="15" label="commands" at={L[0]!} />
          <Stat n="23" label="unit tests" at={L[1]!} />
          <Stat n="7" label="more on a mainnet fork" at={L[2]!} color={C.accent} />
        </div>
        <div style={{ position: "absolute", left: 120, top: 480, opacity: move(t, L[3]! - 0.1, 0.5) }}>
          <Label color={C.ink3} size={26}>
            Install it
          </Label>
          <div style={{ marginTop: 16, display: "inline-block", fontFamily: F.mono, fontSize: 44, padding: "18px 30px", borderRadius: 18, background: C.raised, boxShadow: `0 0 0 1.5px ${C.champagne}, ${glow(C.champagne, 0.5)}` }}>
            <span style={{ color: C.champagne }}>$ </span>mm plugins install mm-plugin-unison
          </div>
          <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink2, marginTop: 16 }}>npmjs.com/package/mm-plugin-unison · github.com/iamdflame/unison</div>
        </div>
        <div style={{ position: "absolute", left: 120, top: 770, fontFamily: F.display, fontSize: 100, color: C.champagne, textShadow: glow(C.champagne, 0.9) }}>
          <Sweep at={L[4]! + 0.9}>
            <Words text="Let your agent try to snipe us." at={L[4]!} stagger={0.08} dur={0.5} />
          </Sweep>
        </div>
        <Ring at={L[4]!} x={1620} y={620} size={900} />
        <div style={{ position: "absolute", right: 120, top: 430, textAlign: "center", opacity: move(t, L[4]! + 0.2, 0.5), transform: `scale(${t > L[4]! ? Math.max(0.7, pop(t, L[4]! + 0.2, 0.55)) : 0.7})` }}>
          <div style={{ padding: 16, borderRadius: 24, background: C.ink, boxShadow: glow(C.champagne, 0.6) }}>
            <QR url={CHALLENGE_URL} size={250} fg={C.deep} bg={C.ink} />
          </div>
          <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink2, marginTop: 12 }}>unisonfi.com/challenge</div>
        </div>
      </Drift>
    </AbsoluteFill>
  );
};
