import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { MARK_PARTS } from "@/components/brand/geometry";
import { WORDMARK } from "@/components/brand/glyphs";

/** The card a link unfurls into: Nocturne, the mark with a lume ball, the wordmark, and the one sentence. */
export const alt = "Unison: the market that never closes. Tokenized stocks on Monad, one price for everyone, every 300 ms.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function OpenGraphImage() {
  const [bodoni, mona] = await Promise.all([font("BodoniModa-96-400.ttf"), font("MonaSans-400.ttf")]);
  const w = WORDMARK.display;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0b0c10", color: "#eef0f4", padding: "64px 76px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <svg width="46" height="46" viewBox="0 0 48 48">
            {MARK_PARTS.map((p, i) => (
              <path key={i} d={p.d} fill={p.role === "ball" ? "#b6e4fd" : "#eef0f4"} />
            ))}
          </svg>
          <svg width={(w.width / 1550) * 26} height="26" viewBox={`${w.left} ${w.top} ${w.width} ${w.bottom - w.top}`}>
            <path d={w.d} fill="#eef0f4" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "Bodoni", fontSize: 96, lineHeight: 1, letterSpacing: "-0.02em" }}>The market that</div>
          <div style={{ fontFamily: "Bodoni", fontSize: 96, lineHeight: 1.06, letterSpacing: "-0.02em" }}>never closes.</div>
          <div style={{ fontFamily: "Mona", fontSize: 29, color: "#a9b0bc", marginTop: 34 }}>
            Tokenized stocks on Monad. One price for everyone, every 300 ms.
          </div>
        </div>
        <div style={{ display: "flex", height: 1, background: "linear-gradient(90deg, #d8c9a4 0%, rgba(216,201,164,0) 70%)" }} />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bodoni", data: bodoni, weight: 400, style: "normal" },
        { name: "Mona", data: mona, weight: 400, style: "normal" },
      ],
    },
  );
}
