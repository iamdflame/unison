import { AbsoluteFill, interpolate } from "remotion";
import { C, F, settle } from "../brand";
import { Backdrop, clamp01, glow, Label, move, useT, Words } from "../kit/Fx";
import { MovementPart } from "../kit/MovementParts";
import { useLine } from "../kit/Plan";

/**
 * The cold open: the escapement of a watch, lit from behind, ticking once per Monad block while the camera pulls out
 * from the escape wheel to the movement. The drawings are the site's own movement (apps/web), engraved deeper for
 * the screen. The narration is set in the film's type over it, line by line (the beat runs without captions).
 */
const VARS = { "--champagne": C.champagne, "--jewel": C.jewel, "--bg": C.bg } as React.CSSProperties;

function Phase({ from, to, children }: { from: number; to: number; children: React.ReactNode }) {
  const t = useT();
  const o = Math.min(move(t, from, 0.3), 1 - clamp01((t - to) / 0.3));
  return o > 0 ? <div style={{ position: "absolute", left: 0, right: 0, bottom: 150, textAlign: "center", opacity: o, transform: `translateY(${(1 - move(t, from, 0.5)) * 18}px)` }}>{children}</div> : null;
}

export const ColdOpen = () => {
  const t = useT();
  const L = [useLine("demo-01", 0, 1.05), useLine("demo-01", 1, 4.59), useLine("demo-01", 2, 6.77)];
  // one tick per 300 ms block: the escape wheel advances a tooth with a small recoil, and the jewels catch the light
  const beat = t / 0.3;
  const tooth = Math.floor(beat);
  const phase = beat - tooth;
  const recoil = phase < 0.18 ? Math.sin((phase / 0.18) * Math.PI) * 1.2 : 0;
  const wheel = tooth * (360 / 15) * 0.5 + recoil;
  const balance = Math.sin(t * Math.PI * 2 * 1.6667) * 160;
  const glint = phase < 0.14 ? 1 - phase / 0.14 : 0;
  const pull = interpolate(t, [0, 11.5], [2.5, 1.02], { extrapolateRight: "clamp", easing: (x) => 1 - (1 - x) ** 3 });
  const turn = interpolate(t, [0, 11.5], [-6, 0], { extrapolateRight: "clamp" });
  const fade = settle(clamp01(t / 0.7));
  return (
    <AbsoluteFill style={{ opacity: fade, ...VARS }}>
      <Backdrop light={C.champagne} x={50} y={42} strength={0.2} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateY(-70px) scale(${pull}) rotate(${turn}deg)` }}>
        <div style={{ position: "relative", width: 1000, height: 1000, color: C.ink2, filter: `drop-shadow(0 0 ${8 + 14 * glint}px color-mix(in oklch, ${C.champagne} ${35 + 30 * glint}%, transparent))` }}>
          <div style={{ position: "absolute", inset: 0, opacity: 0.75 }}>
            <MovementPart name="Vault" weight={1.6} />
          </div>
          <div style={{ position: "absolute", left: 366, top: 133, width: 490, height: 490, transform: `rotate(${wheel}deg)`, color: C.ink }}>
            <MovementPart name="Clearing" weight={2.6} />
          </div>
          <div style={{ position: "absolute", left: 88, top: 478, width: 420, height: 420, transform: `rotate(${balance}deg)`, color: C.champagne }}>
            <MovementPart name="References" weight={2.6} />
          </div>
        </div>
      </AbsoluteFill>
      {/* a shade for the words */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 90% 48% at 50% 88%, oklch(0.04 0.004 265 / 0.94), oklch(0.04 0.004 265 / 0.5) 55%, transparent 80%)" }} />
      <div style={{ position: "absolute", left: 80, top: 70, opacity: move(t, 0.8, 0.8) }}>
        <Label color={C.ink3} size={26}>
          One tick per Monad block · 300 ms
        </Label>
      </div>
      <Phase from={L[0]!} to={L[1]! - 0.35}>
        <div style={{ fontFamily: F.display, fontSize: 96, lineHeight: 1.05, color: C.ink }}>
          <Words text="Every price on a blockchain…" at={L[0]!} stagger={0.12} dur={0.7} />
        </div>
        <div style={{ fontFamily: F.display, fontSize: 160, lineHeight: 1.05, color: C.champagne, textShadow: glow(C.champagne, 0.8), marginTop: 6 }}>
          <Words text="is already old." at={L[0]! + 1.75} stagger={0.14} dur={0.7} />
        </div>
      </Phase>
      <Phase from={L[1]!} to={L[2]! - 0.3}>
        <div style={{ fontFamily: F.display, fontSize: 104, lineHeight: 1.05, color: C.ink }}>
          <Words text="Chainlink sees the market move —" at={L[1]!} stagger={0.1} dur={0.6} accent={{ Chainlink: C.accent }} />
        </div>
      </Phase>
      <Phase from={L[2]!} to={99}>
        <div style={{ fontFamily: F.display, fontSize: 92, lineHeight: 1.1, color: C.ink2 }}>
          <Words text="and about thirteen seconds later," at={L[2]!} stagger={0.1} dur={0.6} accent={{ thirteen: C.champagne, seconds: C.champagne }} />
        </div>
        <div style={{ fontFamily: F.display, fontSize: 104, lineHeight: 1.1, color: C.ink, marginTop: 4 }}>
          <Words text="that price finally lands on chain." at={L[2]! + 1.55} stagger={0.1} dur={0.6} />
        </div>
      </Phase>
    </AbsoluteFill>
  );
};
