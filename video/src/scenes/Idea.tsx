import { AbsoluteFill, interpolate } from "remotion";
import { C, F, settle } from "../brand";
import script from "../data/script.json";
import { Backdrop, clamp01, Drift, glow, Label, move, Narration, pop, Ring, Sweep, useT, Words } from "../kit/Fx";
import { useLine } from "../kit/Plan";

/**
 * The flip. On the old rule the price comes first and your order after it, so anyone who sees the price first can
 * trade against you. Unison swaps the two: the tiles change places, your order is sealed into a block, the price is
 * set after by Chainlink's next observation, and one price fills every order at once. No amounts: this is the rule,
 * not a trade.
 */
const ORDERS = [
  { side: "Buy", color: C.buy },
  { side: "Sell", color: C.sell },
  { side: "Buy", color: C.buy },
];
const LEFT = 560;
const RIGHT = 1360;
const MID = 470;

/**
 * Which line of the narration each moment lands on: the flip, the seal, Chainlink's observation (a line, and how far
 * into it), the one price, and the line set large at the end, if the voice has one. The demo and the pitch say the
 * idea in different words.
 */
export interface IdeaCues {
  voice: "demo-03" | "pitch-03";
  flip: number;
  sealed: number;
  observed: [number, number];
  beam: number;
  coda: number | null;
  /** fallbacks for a scene played on its own: when each line starts */
  at: number[];
}
export const DEMO_IDEA: IdeaCues = { voice: "demo-03", flip: 0, sealed: 1, observed: [3, 0.75], beam: 4, coda: 5, at: [0.46, 2.32, 4.4, 6.38, 8.92, 11.72] };
export const PITCH_IDEA: IdeaCues = { voice: "pitch-03", flip: 0, sealed: 1, observed: [2, 1.6], beam: 3, coda: null, at: [0.36, 2.33, 3.7, 6.92, 8.38] };

export const Idea = ({ cues = DEMO_IDEA }: { cues?: IdeaCues }) => {
  const t = useT();
  const L = [0, 1, 2, 3, 4, 5].map((i) => useLine(cues.voice, i, cues.at[i] ?? 99));
  const lines = script[cues.voice];
  const end = cues.coda !== null ? L[cues.coda]! : 99;
  const flipAt = L[cues.flip]! + 0.75;
  const flip = settle(clamp01((t - flipAt) / 0.9));
  const arc = Math.sin(Math.PI * flip);
  const open = settle(clamp01((t - L[cues.sealed]! + 0.1) / 0.6));
  const stamp = L[cues.sealed]! + 0.2;
  const observed = L[cues.observed[0]]! + cues.observed[1];
  const obs = settle(clamp01((t - observed) / 0.5));
  const beam = L[cues.beam]! + 0.35;
  const sweep = clamp01((t - beam) / 0.7);
  const coda = cues.coda !== null ? settle(clamp01((t - end + 0.15) / 0.7)) : 0;
  // the tiles: the price starts on the left (the old rule), your order on the right; then they change places
  const priceX = LEFT + (RIGHT - LEFT) * flip;
  const orderX = RIGHT - (RIGHT - LEFT) * flip;
  const orderH = 300 + 300 * open;
  const tile = (x: number, y: number, w: number, h: number, color: string, lit: number) =>
    ({
      position: "absolute",
      left: x - w / 2,
      top: y - h / 2,
      width: w,
      height: h,
      borderRadius: 34,
      background: `linear-gradient(160deg, color-mix(in oklch, ${color} ${8 + 10 * lit}%, ${C.raised}), ${C.sunken})`,
      border: `2px solid color-mix(in oklch, ${color} ${35 + 45 * lit}%, transparent)`,
      boxShadow: `0 30px 80px oklch(0 0 0 / 0.45), 0 0 ${40 * lit}px color-mix(in oklch, ${color} ${30 * lit}%, transparent)`,
    }) as const;
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={flip > 0.5 ? C.accent : C.sell} x={50} y={30} strength={0.11} />
      <Drift to={1.035} over={13}>
        <AbsoluteFill style={{ opacity: 1 - 0.88 * coda, filter: coda > 0 ? `blur(${6 * coda}px)` : undefined, transform: `scale(${1 - 0.06 * coda})` }}>
        {/* which rule */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center" }}>
          <div style={{ opacity: 1 - flip, position: "absolute", left: 0, right: 0 }}>
            <Label color={C.sell} size={34} style={{ letterSpacing: "0.24em" }}>
              The old rule · the price comes first
            </Label>
          </div>
          <div style={{ opacity: flip, position: "absolute", left: 0, right: 0 }}>
            <Label color={C.accent} size={34} style={{ letterSpacing: "0.24em" }}>
              Unison · your order comes first
            </Label>
          </div>
        </div>
        <div style={{ position: "absolute", left: 930, top: MID - 60 - 150 * open * 0, fontFamily: F.display, fontSize: 110, color: C.ink3, opacity: 1 - 0.6 * open }}>→</div>

        {/* the price */}
        <div style={{ ...tile(priceX, MID - 140 * arc, 600, 300, flip > 0.5 ? C.accent : C.champagne, obs), transform: `rotate(${-6 * arc}deg)` }}>
          <div style={{ position: "absolute", left: 44, top: 34 }}>
            <Label color={obs > 0.5 ? C.accent : C.ink3} size={26}>
              {obs > 0.5 ? "Chainlink's next observation" : "The price"}
            </Label>
          </div>
          <div style={{ position: "absolute", left: 44, bottom: 40, fontFamily: F.display, fontSize: 104, lineHeight: 1, whiteSpace: "nowrap", color: obs > 0.5 ? C.ink : flip > 0.5 ? C.ink3 : C.champagne, textShadow: obs > 0.5 ? glow(C.accent, 0.9) : undefined }}>
            {obs > 0.5 ? <Sweep at={observed + 0.2}>observed</Sweep> : flip > 0.5 && t > L[cues.sealed]! ? <i>not yet</i> : "the price"}
          </div>
        </div>
        <Ring at={observed} x={RIGHT} y={MID} size={1000} color={C.accent} width={3} />
        <Ring at={observed + 0.2} x={RIGHT} y={MID} size={700} color={C.accent} width={2} />

        {/* your order, then the block it is sealed into */}
        <div style={{ ...tile(orderX, MID + 140 * arc + 150 * open, 600, orderH, C.ink, open * 0.4), transform: `rotate(${6 * arc}deg)` }}>
          <div style={{ position: "absolute", left: 44, top: 34 }}>
            <Label color={C.ink3} size={26}>
              {open > 0.5 ? "One Monad block · 300 ms" : "Your order"}
            </Label>
          </div>
          {open < 0.5 ? (
            <div style={{ position: "absolute", left: 44, bottom: 40, fontFamily: F.display, fontSize: 104, lineHeight: 1, whiteSpace: "nowrap", opacity: 1 - 2 * open }}>your order</div>
          ) : null}
          {ORDERS.map((o, i) => {
            const inP = move(t, L[cues.sealed]! + 0.05 + i * 0.12, 0.45);
            const lit = clamp01((sweep - i * 0.18) / 0.3);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 36,
                  right: 36,
                  top: 100 + i * 150,
                  height: 124,
                  borderRadius: 22,
                  opacity: inP * open,
                  transform: `translateX(${(1 - inP) * -60}px)`,
                  background: lit > 0 ? `color-mix(in oklch, ${o.color} ${12 + 22 * lit}%, ${C.raised})` : C.raised,
                  boxShadow: `0 0 0 1.5px ${lit > 0.5 ? o.color : C.line}, 0 0 ${30 * lit}px color-mix(in oklch, ${o.color} 40%, transparent)`,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 36px",
                  gap: 26,
                }}
              >
                <div style={{ width: 20, height: 20, borderRadius: 10, background: o.color }} />
                <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 52 }}>{o.side}</div>
                <div style={{ marginLeft: "auto", fontFamily: F.mono, fontSize: 36, color: lit > 0.5 ? o.color : C.ink3 }}>{lit > 0.5 ? "filled" : t > stamp ? "sealed" : "…"}</div>
              </div>
            );
          })}
        </div>

        {/* the seal, pressed */}
        {t > stamp ? (
          <div style={{ position: "absolute", left: LEFT + 190, top: MID + 150 - 330, width: 190, height: 190, borderRadius: 95, background: `radial-gradient(circle at 38% 34%, oklch(0.62 0.16 22), ${C.jewel} 62%, oklch(0.42 0.12 20))`, boxShadow: `0 10px 40px oklch(0 0 0 / 0.5), ${glow(C.jewel, 0.6)}`, transform: `scale(${pop(t, stamp, 0.45)}) rotate(-14deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: F.display, fontSize: 40, letterSpacing: "0.06em", color: "oklch(0.92 0.03 30)" }}>SEALED</div>
          </div>
        ) : null}

        {/* one price, through every order */}
        {sweep > 0 && sweep < 1 ? <div style={{ position: "absolute", left: RIGHT - (RIGHT - LEFT + 400) * settle(sweep), top: MID + 150 - 6, width: 420, height: 12, borderRadius: 6, background: `linear-gradient(90deg, transparent, ${C.accent}, ${C.ink})`, boxShadow: glow(C.accent, 1.2), opacity: 1 - sweep * 0.3 }} /> : null}

        </AbsoluteFill>
        {/* the narration, then its last line, large */}
        <Narration
          lines={lines.slice(0, cues.coda ?? lines.length).map((l, i, shown) => ({ text: l.text, at: L[i]!, until: i < shown.length - 1 ? L[i + 1]! - 0.1 : cues.coda !== null ? end - 0.2 : 99 }))}
          accent={{ flips: C.accent, first: C.accent, after: C.accent, One: C.champagne, one: C.champagne, price: C.champagne, receipt: C.buy }}
          bottom={70}
          size={58}
        />
        {/* nothing to snipe (the demo's last line) */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 440, textAlign: "center", opacity: coda }}>
          <div style={{ fontFamily: F.display, fontSize: 150, lineHeight: 1, color: C.ink, textShadow: glow(C.champagne, 0.6) }}>
            <Sweep at={end + 0.5} dur={1.2}>
              <Words text={cues.coda !== null ? lines[cues.coda]!.text : ""} at={end - 0.1} stagger={0.12} dur={0.6} />
            </Sweep>
          </div>
        </div>
      </Drift>
    </AbsoluteFill>
  );
};
