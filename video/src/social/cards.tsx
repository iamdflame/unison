import { F } from "../brand";
import { CHALLENGE_RESULT } from "../data/chain";
import waits from "../data/causal-waits.json";
import { LIGHT, MAT } from "./horology/materials";
import { Paper } from "./horology/Paper";
import { Headline, Masthead, Studio } from "./horology/Studio";
import { Arbor, DIAL, DialText, Hand, Rosette, Subdial, Watch } from "./horology/Watch";
import { Ribbon, WaxSeal } from "./horology/WaxSeal";

/** A point on a dial: `sec` on a 60-step track (0 at twelve, clockwise), at radius r. */
const at = (sec: number, r: number) => {
  const t = (sec / 60) * Math.PI * 2;
  return { x: r * Math.sin(t), y: -r * Math.cos(t) };
};

/**
 * The X series, as watch-ad photographs: one lit object per post that shows its number, one line in Bodoni, and the
 * light following the market (Porcelain while Wall Street trades, Nocturne while it's closed). Every number comes
 * from src/data. Render: npx remotion still src/index.ts <Id> out/x/<card>.png --scale=1.5
 */

const day = LIGHT.porcelain;

/** A signed number: the sign set in the sans, where a hairline Bodoni sign would vanish. */
function Signed({ v, size, color }: { v: number; size: number; color: string }) {
  return (
    <span style={{ fontFamily: F.display, fontSize: size, lineHeight: 1, color, whiteSpace: "nowrap" }}>
      <span style={{ fontFamily: F.text, fontWeight: 400, fontSize: size * 0.82, marginRight: size * 0.04, position: "relative", top: -size * 0.04 }}>
        {v >= 0 ? "+" : "−"}
      </span>
      {Math.abs(v).toFixed(2)}
      <span style={{ fontSize: size * 0.55, marginLeft: size * 0.12, color: day.ink2 }}>bp</span>
    </span>
  );
}

/** Wed 14 Oct: the same sniper, judged by both challenge contracts. One seal broke; Unison's held. */
export const CardPaid = () => {
  const r = CHALLENGE_RESULT;
  const sheet = (side: "old" | "unison") => {
    const old = side === "old";
    const w = old ? 640 : 668;
    const hgt = old ? 384 : 404;
    // the seal sits toward the sheet's lower corner, clear of the figures
    const sx = old ? w - 100 : w - 128;
    const sy = old ? hgt - 84 : hgt - 118;
    return (
      <Paper x={old ? 92 : 836} y={old ? 432 : 412} w={w} h={hgt} rotate={old ? -3.2 : 2.1}>
        <div style={{ position: "absolute", left: 64, top: 58, fontFamily: F.displaySmall, fontWeight: 550, fontSize: 34, color: day.ink }}>
          {old ? "Old rule" : "Unison"}
        </div>
        <div style={{ position: "absolute", left: 62, top: 112 }}>
          <Signed v={old ? r.control.bps : r.unison.bps} size={108} color={day.ink} />
        </div>
        <div style={{ position: "absolute", left: 66, top: 236, fontFamily: F.text, fontSize: 25, color: day.ink2 }}>
          edge over {old ? r.control.fills : r.unison.fills} fills, after fees
        </div>
        <div style={{ position: "absolute", left: 66, top: hgt - 96, fontFamily: F.text, fontWeight: 600, fontSize: 29, color: old ? day.sell : day.ink }}>
          {old ? `Paid out, ${r.control.paidOn}` : `${r.unison.pot}, unclaimed`}
        </div>
        <Ribbon x={sx} y={sy - 10} length={168} spread={old ? [30, -14] : [26, -18]} />
        <WaxSeal x={sx} y={sy} size={old ? 186 : 196} rotate={old ? 8 : -6} seed={old ? 9 : 4} broken={old} />
      </Paper>
    );
  };
  return (
    <Studio finish="porcelain" keyX={24} keyY={14}>
      <Masthead finish="porcelain" />
      <Headline
        finish="porcelain"
        lines={["The old rule paid our sniper.", "Unison's seal held."]}
        sub="Same bot, same signal, same Chainlink feed. Two markets on Monad mainnet."
        y={124}
        size={82}
        subSize={31}
      />
      {sheet("old")}
      {sheet("unison")}
    </Studio>
  );
};

/** Thu 15 Oct: a stopwatch whose seconds ring is the data. Each printed dot is one auction, at the seconds from its seal to
 *  Chainlink's first observation after it, stacked inward; the blued hand stands at the median. */
export const CardWait = () => {
  const median = waits.observedAfterSeal.p50;
  const stacks = new Map<number, number>();
  const dots = waits.waits.map((w) => {
    const s = Math.min(w, 60); // the two past a minute are shown at 60, marked 60+
    const n = stacks.get(s) ?? 0;
    stacks.set(s, n + 1);
    return at(s, 380 - n * 15);
  });
  return (
    <Studio finish="porcelain" keyX={22} keyY={12}>
      <Masthead finish="porcelain" />
      <Headline
        finish="porcelain"
        lines={["Sealed first.", `Priced ${median} s later.`]}
        sub={`Seconds from each auction's seal to Chainlink's first observation after it: ${waits.auctions} auctions on Monad mainnet, 6 to 14 October.`}
        y={168}
        size={80}
        width={640}
        subSize={30}
      />
      <div style={{ position: "absolute", left: 72, top: 540, display: "flex", alignItems: "center", gap: 14, fontFamily: F.text, fontSize: 28, color: day.ink2 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: MAT.print }} />
        Each dot is one auction.
      </div>
      <Watch cx={1148} cy={462} size={800} finish="porcelain" pushers>
        <Rosette r={150} color={MAT.print} opacity={0.22} />
        <circle r={210} fill="none" stroke={MAT.print} strokeOpacity={0.5} strokeWidth={1.4} />
        <circle r={392} fill="none" stroke={MAT.print} strokeOpacity={0.35} strokeWidth={1} />
        {Array.from({ length: 12 }, (_, i) => {
          const sec = (i + 1) * 5;
          const p = at(sec, 250);
          return (
            <DialText key={sec} x={p.x} y={p.y} size={46} color={MAT.print}>
              {sec === 60 ? "60+" : sec}
            </DialText>
          );
        })}
        {dots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={6.2} fill={MAT.print} />
        ))}
        <DialText x={0} y={-178} size={28} color={MAT.print} spacing="0.32em">
          UNISON
        </DialText>
        <Subdial x={0} y={128} r={70} finish="porcelain">
          <DialText x={0} y={-8} size={58} color={day.ink}>
            {waits.auctions}
          </DialText>
          <DialText x={0} y={38} size={22} color={day.ink2} face="text">
            auctions
          </DialText>
        </Subdial>
        <Hand deg={(median / 60) * 360} kind="lance" length={372} tail={96} width={13} material="blued" />
        <Arbor finish="porcelain" />
      </Watch>
    </Studio>
  );
};
