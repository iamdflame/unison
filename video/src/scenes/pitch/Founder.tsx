import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, F, s, settle } from "../../brand";
import { useLine } from "../../kit/Plan";

/**
 * The pitch opens on the founder (pitch-01): the photo, the name, the story in a line. Then "Crypto never closes.
 * Stocks do.": the week as a dial, crypto's ring lit all the way round, Nasdaq's lit only for its sessions (the
 * site's own geometry, apps/web/components/marketing/chapters/neverClosesGeometry.ts).
 */
export const FOUNDER = { name: "Dflame", role: "Founder, Unison", photo: "private/founder.jpg" };

const SLOTS = 336;
/** Nasdaq's week in half hours, Monday 00:00 New York = 0: regular 9:30–16:00, extended 4:00–9:30 and 16:00–20:00 */
const kind = (slot: number) => {
  const day = Math.floor(slot / 48);
  const h = (slot % 48) / 2;
  if (day >= 5) return "closed";
  if (h >= 9.5 && h < 16) return "regular";
  if ((h >= 4 && h < 9.5) || (h >= 16 && h < 20)) return "extended";
  return "closed";
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeekDial({ t, show }: { t: number; show: number }) {
  const cx = 1340;
  const cy = 540;
  const hand = interpolate(t, [0, 5.5], [0, SLOTS], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ring = (r: number, slot: number) => {
    const a = (slot / SLOTS) * Math.PI * 2 - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const seg = (r: number, from: number, to: number) => {
    const [x1, y1] = ring(r, from);
    const [x2, y2] = ring(r, to);
    return `M${x1},${y1} A${r},${r} 0 ${to - from > SLOTS / 2 ? 1 : 0} 1 ${x2},${y2}`;
  };
  const [hx, hy] = ring(330, hand);
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: show }}>
      {/* crypto: every half hour of the week */}
      <circle cx={cx} cy={cy} r={330} fill="none" stroke={C.lineStrong} strokeWidth={22} />
      <path d={seg(330, 0, Math.max(0.01, hand))} fill="none" stroke={C.accent} strokeWidth={22} strokeLinecap="butt" />
      {/* Nasdaq: its sessions only, drawn as the hand passes them */}
      <circle cx={cx} cy={cy} r={262} fill="none" stroke={C.line} strokeWidth={22} />
      {Array.from({ length: SLOTS }, (_, i) => {
        const k = kind(i);
        if (k === "closed" || i >= hand) return null;
        return <path key={i} d={seg(262, i, i + 1.02)} fill="none" stroke={k === "regular" ? C.champagne : "oklch(0.82 0.05 85 / 0.35)"} strokeWidth={22} />;
      })}
      {DAYS.map((d, i) => {
        const [x, y] = ring(410, i * 48 + 24);
        return (
          <text key={d} x={x} y={y + 9} textAnchor="middle" fill={C.ink3} style={{ font: `500 24px ${F.text}` }}>
            {d}
          </text>
        );
      })}
      <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={C.ink} strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={9} fill={C.ink} />
    </svg>
  );
}

export const Founder = () => {
  const f = useCurrentFrame();
  const t = f / s(1);
  // each moment on its words: "I'm Dflame." / "…crypto and stocks…" / "…I build products." / "Crypto never closes." / "Stocks do."
  const at = [useLine("pitch-01", 0, 0.7), useLine("pitch-01", 1, 2.0), useLine("pitch-01", 2, 3.6), useLine("pitch-01", 3, 7.0), useLine("pitch-01", 4, 9.0)];
  const ramp = (a: number, b: number) => settle(interpolate(t, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const photo = ramp(0, 1.1);
  const name = ramp(at[0]! - 0.2, at[0]! + 0.8);
  const line1 = ramp(at[1]! - 0.1, at[1]! + 0.7);
  const line2 = ramp(at[2]! - 0.1, at[2]! + 0.7);
  // at "Crypto never closes": the photo gives way to the week
  const week = ramp(at[3]! - 0.9, at[3]! + 0.1);
  const never = ramp(at[3]! - 0.2, at[3]! + 0.6);
  const closes = ramp(at[4]! - 0.1, at[4]! + 0.7);
  // head and shoulders, drifting closer
  const push = interpolate(t, [0, 14], [1.55, 1.66]);
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.ink }}>
      {/* the photo: the person, as they are */}
      <div
        style={{
          position: "absolute",
          left: 1000,
          top: 100,
          width: 760,
          height: 880,
          borderRadius: 28,
          overflow: "hidden",
          opacity: photo * (1 - week),
          transform: `translateX(${(1 - photo) * 40 + week * 80}px)`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
        }}
      >
        <Img src={staticFile(FOUNDER.photo)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "51% 30%", transform: `scale(${push})`, transformOrigin: "51% 34%" }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to right, ${C.bg} 0%, transparent 22%)` }} />
      </div>

      <div style={{ position: "absolute", left: 160, top: 330, opacity: 1 - week, transform: `translateX(${-week * 60}px)` }}>
        <div style={{ fontFamily: F.text, fontSize: 24, letterSpacing: "0.18em", color: C.ink2, opacity: name }}>{FOUNDER.role.toUpperCase()}</div>
        <div style={{ fontFamily: F.display, fontSize: 168, lineHeight: 1, marginTop: 18, opacity: name, transform: `translateY(${(1 - name) * 16}px)` }}>{FOUNDER.name}</div>
        <div style={{ fontFamily: F.text, fontSize: 40, color: C.ink, marginTop: 54, opacity: line1 }}>Trades crypto and stocks.</div>
        <div style={{ fontFamily: F.text, fontSize: 40, color: C.champagne, marginTop: 14, opacity: line2 }}>Builds products.</div>
      </div>

      <WeekDial t={t - (at[3]! - 0.7)} show={week} />
      <div style={{ position: "absolute", left: 160, top: 360, opacity: week }}>
        <div style={{ fontFamily: F.text, fontSize: 24, letterSpacing: "0.16em", color: C.ink3 }}>ONE WEEK, 168 HOURS</div>
        <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 20, opacity: never }}>
          <div style={{ width: 36, height: 12, borderRadius: 6, background: C.accent }} />
          <div style={{ fontFamily: F.display, fontSize: 72 }}>Crypto never closes.</div>
        </div>
        <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink3, marginTop: 8, marginLeft: 56, opacity: never }}>168 of 168 hours</div>
        <div style={{ marginTop: 44, display: "flex", alignItems: "center", gap: 20, opacity: closes }}>
          <div style={{ width: 36, height: 12, borderRadius: 6, background: C.champagne }} />
          <div style={{ fontFamily: F.display, fontSize: 72 }}>Stocks do.</div>
        </div>
        <div style={{ fontFamily: F.text, fontSize: 28, color: C.ink3, marginTop: 8, marginLeft: 56, opacity: closes }}>Nasdaq: 32.5 regular hours a week</div>
      </div>
    </AbsoluteFill>
  );
};
