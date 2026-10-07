import { AbsoluteFill, interpolate } from "remotion";
import { C, F, settle } from "../brand";
import { PHOTO_FINISH as P } from "../data/chain";
import { Backdrop, clamp01, Drift, Flash, glow, Label, move, pop, Sweep, useT, Words } from "../kit/Fx";

/**
 * The photo finish, from mainnet on 6 October 2026: our own sniper sold the same 3 WMON under both rules. The old
 * rule filled it two seconds after the seal, off a round observed before the move. Unison waited for Chainlink's
 * next observation. Shot as a race broadcast: one clock, two lanes and what each one is doing, then the camera's
 * flash, the freeze, and the verdict.
 *
 * `race` is when the clock runs (seconds of the scene) and `freeze` when the shutter fires: the demo races for nine
 * seconds, the ad for five.
 */
const T0 = 13 * 3600 + 57 * 60 + 54; // 13:57:54
const T1 = 13 * 3600 + 58 * 60 + 17; // 13:58:17
const sec = (hms: string) => {
  const [h, m, x] = hms.split(":").map(Number);
  return h! * 3600 + m! * 60 + x!;
};
const clock = (t: number) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const x = Math.floor(t % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};
const X0 = 520;
const X1 = 1800;
const xAt = (now: number) => X0 + ((now - T0) / (T1 - T0)) * (X1 - X0);

interface Status {
  at: string;
  label: string;
  big: string;
  note?: string;
  color: string;
}

function Lane({ y, title, rule, color, now, t, toScene, statuses }: { y: number; title: string; rule: string; color: string; now: number; t: number; toScene: (hms: string) => number; statuses: Status[] }) {
  const current = [...statuses].reverse().find((st) => now >= sec(st.at));
  const since = current ? t - toScene(current.at) : 0;
  const pulse = current ? interpolate(since, [0, 0.08, 0.9], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const head = xAt(Math.min(Math.max(now, T0), T1));
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top: y, height: 330, borderRadius: 28, overflow: "hidden", border: `1.5px solid color-mix(in oklch, ${color} ${30 + 40 * pulse}%, transparent)`, boxShadow: `0 0 ${30 + 60 * pulse}px color-mix(in oklch, ${color} ${10 + 30 * pulse}%, transparent)` }}>
      <AbsoluteFill style={{ background: `linear-gradient(100deg, color-mix(in oklch, ${color} ${16 + 14 * pulse}%, ${C.deep}) 0%, color-mix(in oklch, ${color} 5%, ${C.deep}) 55%, ${C.deep} 100%)` }} />
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, background: color, boxShadow: glow(color, 0.6) }} />
      {/* who */}
      <div style={{ position: "absolute", left: 56, top: 44, width: 400 }}>
        <div style={{ fontFamily: F.display, fontSize: 70, lineHeight: 1, color: C.ink }}>{title}</div>
        <div style={{ fontFamily: F.text, fontSize: 27, lineHeight: 1.3, color: C.ink2, marginTop: 16 }}>{rule}</div>
      </div>
      {/* what it is doing now */}
      {statuses.map((st) => {
        const a = toScene(st.at);
        const isNow = current === st;
        const inP = pop(t, a, 0.45);
        const outP = isNow ? 0 : move(t, statuses[statuses.indexOf(st) + 1] ? toScene(statuses[statuses.indexOf(st) + 1]!.at) : 1e9, 0.25);
        if (t < a || outP >= 1) return null;
        return (
          <div key={st.at + st.label} style={{ position: "absolute", left: X0 - 60 + 40, top: 46, opacity: clamp01(inP) * (1 - outP), transform: `translateY(${(1 - Math.min(1, inP)) * 24 - outP * 30}px) scale(${0.96 + 0.04 * Math.min(1.05, inP)})`, transformOrigin: "0 50%" }}>
            <Label color={st.color} size={30}>
              {st.label}
            </Label>
            <div style={{ fontFamily: F.display, fontSize: 96, lineHeight: 1.05, color: C.ink, marginTop: 6, textShadow: glow(st.color, 0.45) }}>{st.big}</div>
            {st.note ? <div style={{ fontFamily: F.text, fontSize: 28, color: st.color, marginTop: 6 }}>{st.note}</div> : null}
          </div>
        );
      })}
      {/* the track */}
      <div style={{ position: "absolute", left: X0 - 60, top: 278, height: 6, borderRadius: 3, background: C.lineStrong, width: X1 - X0 }} />
      <div style={{ position: "absolute", left: X0 - 60, top: 278, height: 6, borderRadius: 3, width: Math.max(0, head - X0), background: color, boxShadow: glow(color, 0.5) }} />
      <div style={{ position: "absolute", left: head - 60 - 13, top: 268, width: 26, height: 26, borderRadius: 13, background: C.ink, boxShadow: `0 0 0 6px color-mix(in oklch, ${color} 45%, transparent), ${glow(color, 0.8)}` }} />
      {statuses.map((st) => (
        <div key={`tick-${st.at}-${st.label}`} style={{ position: "absolute", left: xAt(sec(st.at)) - 60 - 2, top: 264, width: 4, height: 34, borderRadius: 2, background: now >= sec(st.at) ? st.color : C.lineStrong }} />
      ))}
    </div>
  );
}

export const PhotoFinish = ({ race = [0.8, 9.8], freeze = 9.98 }: { race?: [number, number]; freeze?: number }) => {
  const t = useT();
  const now = interpolate(t, race, [T0, T1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const toScene = (hms: string) => race[0] + ((sec(hms) - T0) / (T1 - T0)) * (race[1] - race[0]);
  const frozen = t >= freeze;
  const card = settle(clamp01((t - freeze - 0.32) / 0.7));
  const still = interpolate(t, [freeze, freeze + 0.32], [1, 1.05], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shake = frozen && t < freeze + 0.25 ? Math.sin(t * 190) * 6 * (1 - (t - freeze) / 0.25) : 0;
  const intro = move(t, 0, 0.6);
  return (
    <AbsoluteFill style={{ color: C.ink }}>
      <Backdrop light={C.champagne} x={50} y={8} strength={0.1} />
      <AbsoluteFill style={{ opacity: 1 - card, transform: `scale(${still}) translateX(${shake}px)`, filter: frozen ? `saturate(${1 - 0.6 * clamp01((t - freeze) / 0.2)}) contrast(1.08)` : undefined }}>
        <Drift to={1.03} over={10}>
          {/* the broadcast's top line: what this is, the race clock, what's equal */}
          <div style={{ position: "absolute", left: 60, top: 52, opacity: intro }}>
            <Label color={C.champagne} size={30}>
              Photo finish
            </Label>
            <div style={{ fontFamily: F.text, fontSize: 27, color: C.ink2, marginTop: 8 }}>
              Our own sniper · {P.pair} · {P.date}
            </div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 30, textAlign: "center", fontFamily: F.mono, fontSize: 112, letterSpacing: "-0.02em", color: C.ink, fontVariantNumeric: "tabular-nums", textShadow: glow(C.champagne, 0.35), opacity: intro }}>
            {clock(now)}
            <span style={{ fontSize: 36, color: C.ink3 }}> UTC</span>
          </div>
          <div style={{ position: "absolute", right: 60, top: 52, textAlign: "right", opacity: intro }}>
            <Label color={C.ink} size={30}>
              Same {P.quantity}
            </Label>
            <Label color={C.ink2} size={30} style={{ marginTop: 8 }}>
              Same second
            </Label>
          </div>
          <Lane
            y={200}
            title="The old rule"
            rule="priced when the auction clears"
            color={C.sell}
            now={now}
            t={t}
            toScene={toScene}
            statuses={[
              { at: "13:57:56", label: "Sells", big: `${P.quantity}`, color: C.ink2 },
              { at: P.oldRule.filledAt, label: "Filled · 2 s later", big: `$${P.oldRule.price}`, note: `a stale price: Chainlink's, from before the move ($${P.oldRule.staleRound})`, color: C.sell },
            ]}
          />
          <Lane
            y={560}
            title="Unison"
            rule="priced at Chainlink's first observation after the seal"
            color={C.accent}
            now={now}
            t={t}
            toScene={toScene}
            statuses={[
              { at: P.unison.sealedAt, label: `Sealed · block ${P.unison.upTo.toLocaleString("en-US")}`, big: "Its price doesn't exist yet", color: C.ink2 },
              { at: P.unison.observedAt, label: "Chainlink observes · 6 s after the seal", big: `$${P.unison.reference}`, color: C.accent },
              { at: P.unison.clearedAt, label: "Cleared · one price for everyone", big: `$${P.unison.price}`, color: C.buy },
            ]}
          />
        </Drift>
      </AbsoluteFill>

      {/* the shutter */}
      <Flash at={freeze} peak={0.9} dur={0.4} />
      {frozen && card < 1 ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 470, textAlign: "center", opacity: interpolate(t, [freeze + 0.05, freeze + 0.15, freeze + 0.5], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <Label color={C.ink} size={44} style={{ letterSpacing: "0.4em" }}>
            Photo finish
          </Label>
        </div>
      ) : null}

      {/* the verdict */}
      {card > 0 ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: card }}>
          <Backdrop light={C.champagne} x={50} y={46} strength={0.2 * card} fill={C.sell} />
          <div style={{ textAlign: "center", transform: `scale(${0.94 + 0.06 * card})` }}>
            <Label color={C.sell} size={38} style={{ letterSpacing: "0.22em" }}>
              <Words text="The old rule paid the sniper" at={freeze + 0.4} stagger={0.05} />
            </Label>
            <div style={{ fontFamily: F.display, fontSize: 300, lineHeight: 1, marginTop: 10, color: C.champagne, textShadow: glow(C.champagne, 1.1), transform: `scale(${Math.max(0.6, pop(t, freeze + 0.45, 0.6))})` }}>
              <Sweep at={freeze + 1.0} dur={1.2}>
                +{P.gapBps} bp
              </Sweep>
            </div>
            <div style={{ display: "flex", gap: 90, justifyContent: "center", marginTop: 34, opacity: move(t, freeze + 0.9, 0.6) }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: F.display, fontSize: 76, color: C.ink }}>${P.oldRule.price}</div>
                <div style={{ fontFamily: F.text, fontSize: 28, color: C.sell, marginTop: 4 }}>the old rule · a price from before the move</div>
              </div>
              <div style={{ width: 2, background: C.lineStrong }} />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontFamily: F.display, fontSize: 76, color: C.ink }}>${P.unison.price}</div>
                <div style={{ fontFamily: F.text, fontSize: 28, color: C.accent, marginTop: 4 }}>Unison · observed after the seal</div>
              </div>
            </div>
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
