import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";
import { MovementPart } from "../kit/MovementParts";

/**
 * The cold open: the escapement of a watch, ticking once per Monad block, the camera pulling out from the escape
 * wheel to the whole movement. The drawings are the site's own movement (apps/web), so the film and the site share
 * one object.
 */
const VARS = { "--champagne": C.champagne, "--jewel": C.jewel, "--bg": C.bg } as React.CSSProperties;

export const ColdOpen = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  // one tick per 300 ms block: the escape wheel advances a tooth, with a small recoil
  const beat = t / 0.3;
  const tooth = Math.floor(beat);
  const phase = beat - tooth;
  const recoil = phase < 0.18 ? Math.sin((phase / 0.18) * Math.PI) * 1.2 : 0;
  const wheel = tooth * (360 / 15) * 0.5 + recoil;
  const balance = Math.sin(t * Math.PI * 2 * 1.6667) * 160;
  const pull = interpolate(t, [0, 9], [3.2, 1], { extrapolateRight: "clamp", easing: (x) => 1 - Math.pow(1 - x, 3) });
  const fade = settle(interpolate(t, [0, 1.2], [0, 1]));
  const words = settle(interpolate(t, [1.2, 2.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  return (
    <AbsoluteFill style={{ background: C.deep, opacity: fade, ...VARS }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${pull})` }}>
        <div style={{ position: "relative", width: 900, height: 900, color: C.ink2 }}>
          <div style={{ position: "absolute", inset: 0, opacity: 0.55 }}>
            <MovementPart name="Vault" />
          </div>
          <div style={{ position: "absolute", left: 330, top: 120, width: 440, height: 440, transform: `rotate(${wheel}deg)`, color: C.ink }}>
            <MovementPart name="Clearing" />
          </div>
          <div style={{ position: "absolute", left: 80, top: 430, width: 380, height: 380, transform: `rotate(${balance}deg)`, color: C.champagne }}>
            <MovementPart name="References" />
          </div>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 130, bottom: 120, opacity: words }}>
        <div style={{ fontFamily: F.text, fontSize: 24, color: C.ink3, letterSpacing: "0.16em" }}>ONE TICK PER MONAD BLOCK · 300 MS</div>
      </div>
    </AbsoluteFill>
  );
};
