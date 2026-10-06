import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../brand";

/** A pipeline check: the brand's type and palette, one graduation ticking per Monad block (300 ms). */
export const BrandTest = () => {
  const f = useCurrentFrame();
  const head = Math.floor(f / s(0.3)) % 60;
  const t = settle(interpolate(f, [0, s(1.2)], [0, 1]));
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink, alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: F.display, fontSize: 160, letterSpacing: "0.12em", opacity: t, transform: `translateY(${(1 - t) * 24}px)` }}>UNISON</div>
      <div style={{ fontFamily: F.text, fontSize: 34, color: C.ink2, marginTop: 18, opacity: t }}>Prices nobody saw first.</div>
      <div style={{ display: "flex", gap: 9, marginTop: 64, alignItems: "flex-end", height: 56 }}>
        {Array.from({ length: 60 }, (_, i) => {
          const age = (head - i + 60) % 60;
          return (
            <div
              key={i}
              style={{
                width: 4,
                height: age === 0 ? 56 : age < 10 ? 36 : i % 5 === 0 ? 24 : 16,
                background: age === 0 ? C.accent : age < 10 ? C.ink : C.ink3,
                opacity: age > 0 && age < 10 ? 0.9 - age * 0.07 : age >= 10 ? 0.45 : 1,
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 26, color: C.champagne, marginTop: 28 }}>block #111,160,954</div>
    </AbsoluteFill>
  );
};
