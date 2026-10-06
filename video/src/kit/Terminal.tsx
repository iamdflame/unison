import { interpolate, useCurrentFrame } from "remotion";
import { C, F, s } from "../brand";

export interface TermLine {
  /** seconds into the scene when the line appears (typed, for a command) */
  at: number;
  text: string;
  kind?: "cmd" | "out" | "pass" | "fail" | "dim" | "hint" | "intent";
}

const COLOR: Record<NonNullable<TermLine["kind"]>, string> = {
  cmd: C.ink,
  out: C.ink2,
  pass: C.buy,
  fail: C.sell,
  dim: C.ink3,
  hint: C.champagne,
  intent: C.accent,
};

/**
 * A terminal that replays a real transcript: commands type out, output arrives line by line, PASS lines land in
 * verdigris with a flash. Lines are the program's own output (docs/evidence), never written for the film.
 */
export const Terminal = ({
  title,
  lines,
  width = 1500,
  fontSize = 26,
  typeCps = 38,
  maxLines = 18,
}: {
  title: string;
  lines: TermLine[];
  width?: number;
  fontSize?: number;
  typeCps?: number;
  maxLines?: number;
}) => {
  const f = useCurrentFrame();
  const t = f / s(1);
  const shown = lines.filter((l) => t >= l.at);
  const visible = shown.slice(-maxLines);
  return (
    <div
      style={{
        width,
        borderRadius: 18,
        background: "oklch(0.11 0.006 265 / 0.96)",
        boxShadow: `0 0 0 1px ${C.lineStrong}, 0 30px 80px -20px rgba(0,0,0,0.7)`,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 22px", borderBottom: `1px solid ${C.line}` }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 13, height: 13, borderRadius: 7, background: C.lineStrong }} />
        ))}
        <div style={{ marginLeft: 14, fontFamily: F.text, fontSize: 20, color: C.ink3 }}>{title}</div>
      </div>
      <div style={{ padding: "22px 28px 26px", fontFamily: F.mono, fontSize, lineHeight: 1.55, minHeight: fontSize * 1.55 * Math.min(maxLines, 6) }}>
        {visible.map((l, i) => {
          const kind = l.kind ?? "out";
          const age = t - l.at;
          let text = l.text;
          if (kind === "cmd") {
            const n = Math.floor(age * typeCps);
            text = l.text.slice(0, Math.max(0, n));
          }
          const flash = kind === "pass" ? interpolate(age, [0, 0.25], [1, 0], { extrapolateRight: "clamp" }) : 0;
          const caret = kind === "cmd" && i === visible.length - 1 && Math.floor(f / s(0.5)) % 2 === 0;
          return (
            <div
              key={`${l.at}-${i}`}
              style={{
                color: COLOR[kind],
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                background: flash ? `oklch(0.76 0.085 180 / ${0.18 * flash})` : undefined,
                borderRadius: 6,
              }}
            >
              {kind === "cmd" ? <span style={{ color: C.champagne }}>$ </span> : null}
              {text}
              {caret ? <span style={{ background: C.ink, color: C.bg }}> </span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
