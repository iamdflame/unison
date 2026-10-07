import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { C, F, FPS, s, settle } from "../brand";
import { FILM_SALE as S } from "../data/chain";
import { type Move, Shot, shotFrames, TAKES, type TakeName } from "../kit/Screen";

/**
 * The live product, on mainnet (demo 0:45–1:35): www.unisonfi.com, a passkey, a sealed sell of 9 WMON, the wait
 * for Chainlink's next observation, the fill, its certificate and its receipt. Every frame of the page is the
 * capture's (capture/live.mjs, 6 October 2026); the film adds a camera, the pointer, and the chain's own times.
 */
const hms = (sec: number) => new Date(sec * 1000).toISOString().slice(11, 19);
const utc = (hhmmss: string) => {
  const [h, m, x] = hhmmss.split(":").map(Number);
  return h! * 3600 + m! * 60 + x!;
};
/** seconds of a take → UTC seconds of the day, from the capture's own clock */
const clockOf = (take: TakeName, t: number) => {
  const d = new Date(TAKES[take].capturedAt);
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000 + t;
};
const ramp = (t: number, a: number, b: number) => settle(interpolate(t, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

/** The film's own labels sit on a dark plate, so they read over any part of the page. */
const plate = { background: "oklch(0.1 0.006 265 / 0.8)", backdropFilter: "blur(12px)", border: `1px solid ${C.lineStrong}`, borderRadius: 16 } as const;

/** A label in the film's mono, joined by a hairline to the point of the page it names. */
function Callout({ x, y, dx, text, show, color = C.champagne }: { x: number; y: number; dx: number; text: string; show: number; color?: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: "translateY(-50%)", opacity: show, display: "flex", alignItems: "center" }}>
      <div style={{ width: 10, height: 10, borderRadius: 5, background: color, marginLeft: -5 }} />
      <div style={{ width: dx * show, height: 1.5, background: color }} />
      <div style={{ ...plate, padding: "10px 16px", fontFamily: F.mono, fontSize: 22, letterSpacing: "0.05em", color, whiteSpace: "nowrap" }}>{text}</div>
    </div>
  );
}

// the wait, drawn on the chain's clock
const R0 = utc(S.sealedAt);
const R1 = utc(S.clearedAt);
const RX0 = 300;
const RX1 = 1620;
const RAIL = 640;
const rx = (hhmmss: string) => RX0 + ((utc(hhmmss) - R0) / (R1 - R0)) * (RX1 - RX0);
const STOPS = [
  { at: S.sealedAt, label: "Sealed", sub: `block ${S.upTo.toLocaleString("en-US")}`, color: C.ink, right: false },
  { at: S.observedAt, label: "Chainlink observes", sub: `$${S.reference}`, color: C.accent, right: false },
  { at: S.clearedAt, label: "Cleared, one price", sub: `$${S.price}`, color: C.buy, right: true },
];
const GAPS = [
  { from: S.sealedAt, to: S.observedAt, text: "13 s: its price doesn't exist yet" },
  { from: S.observedAt, to: S.landedAt, text: "12 s: the signed report lands on chain" },
];

/** The page dims; the chain's clock runs from the seal to Chainlink's next observation and the auction's clear. */
function SealTimeline({ now, show }: { now: number; show: number }) {
  const lit = (hhmmss: string) => ramp(now, utc(hhmmss) - 0.2, utc(hhmmss) + 0.7);
  const head = RX0 + ((Math.min(Math.max(now, R0), R1) - R0) / (R1 - R0)) * (RX1 - RX0);
  return (
    <AbsoluteFill style={{ opacity: show }}>
      <AbsoluteFill style={{ background: "oklch(0.09 0.005 265 / 0.8)", backdropFilter: "blur(5px)" }} />
      <div style={{ position: "absolute", top: 228, width: "100%", textAlign: "center", fontFamily: F.text, fontSize: 26, letterSpacing: "0.16em", color: C.ink2 }}>SEALED · WAITING FOR CHAINLINK</div>
      <div style={{ position: "absolute", top: 268, width: "100%", textAlign: "center", fontFamily: F.mono, fontSize: 132, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
        {hms(now)}
        <span style={{ fontSize: 40, color: C.ink3 }}> UTC</span>
      </div>
      <div style={{ position: "absolute", left: RX0, top: RAIL - 1, width: RX1 - RX0, height: 2, background: C.lineStrong }} />
      <div style={{ position: "absolute", left: RX0, top: RAIL - 2, width: head - RX0, height: 4, background: C.accent, boxShadow: `0 0 18px ${C.glow}` }} />
      {[S.sealedAt, S.observedAt, S.landedAt, S.clearedAt].map((at, i) => {
        const on = lit(at);
        const r = i === 2 ? 6 : 10;
        const color = i === 3 ? C.buy : i === 1 ? C.accent : C.ink;
        return (
          <div
            key={at}
            style={{ position: "absolute", left: rx(at) - r, top: RAIL - r, width: 2 * r, height: 2 * r, borderRadius: r, background: on > 0.02 ? color : C.raised, boxShadow: `0 0 0 ${8 * on}px color-mix(in oklch, ${color} 22%, transparent), 0 0 0 1.5px ${C.lineStrong}` }}
          />
        );
      })}
      {STOPS.map((stop) => {
        const on = lit(stop.at);
        const x = rx(stop.at);
        return (
          <div key={stop.label} style={{ position: "absolute", bottom: 1080 - RAIL + 30, ...(stop.right ? { right: 1920 - x - 12, textAlign: "right" as const } : { left: x - 12 }), opacity: 0.28 + 0.72 * on }}>
            <div style={{ fontFamily: F.text, fontSize: 27, fontWeight: 600, color: on > 0.5 ? stop.color : C.ink3 }}>{stop.label}</div>
            <div style={{ fontFamily: F.mono, fontSize: 22, color: C.ink2, marginTop: 6 }}>{stop.sub}</div>
            <div style={{ fontFamily: F.mono, fontSize: 18, color: C.ink3, marginTop: 4 }}>{stop.at} UTC</div>
          </div>
        );
      })}
      {GAPS.map((gap) => (
        <div key={gap.text} style={{ position: "absolute", left: rx(gap.from), top: RAIL + 30, width: rx(gap.to) - rx(gap.from), opacity: lit(gap.to) }}>
          <div style={{ height: 12, borderLeft: `1.5px solid ${C.ink3}`, borderRight: `1.5px solid ${C.ink3}`, borderBottom: `1.5px solid ${C.ink3}` }} />
          <div style={{ marginTop: 12, textAlign: "center", fontFamily: F.text, fontSize: 22, color: C.ink2, whiteSpace: "nowrap" }}>{gap.text}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
}

interface Cut {
  take: TakeName;
  from?: number;
  to?: number;
  rate?: number;
  hold?: number;
  moves: Move[];
  pointer?: boolean;
}

// the takes' own seconds: clicks from src/data/footage.json. In the sell, the order's row turns "Sealed" at 5.9 s
// and its toast settles by 6.4 s; the page catches the new reference at 34.2 s and shows the fill at 36.1 s. The
// receipt page scrolls at 3.04 s.
const ARRIVE: Cut = {
  take: "01-arrive",
  moves: [
    { at: 0, x: 960, y: 540, zoom: 1 },
    { at: 0.15, dur: 4.2, x: 960, y: 470, zoom: 1.06 },
  ],
};
const SIGN_IN: Cut = {
  take: "02-signin",
  rate: 0.9,
  hold: 0.6,
  moves: [
    { at: 0, x: 960, y: 540, zoom: 1 },
    { at: 0.6, dur: 0.9, x: 960, y: 545, zoom: 1.34 },
  ],
};
const SELL: Cut = {
  take: "03-sell",
  from: 0.3,
  to: 8.2,
  moves: [
    { at: 0.3, x: 960, y: 540, zoom: 1 },
    { at: 0.32, dur: 0.75, x: 1586, y: 500, zoom: 1.3 },
    { at: 5.2, dur: 0.75, x: 760, y: 860, zoom: 1.55 },
    { at: 7.1, dur: 0.75, x: 960, y: 160, zoom: 1.75 },
  ],
};
const WAIT: Cut = {
  take: "03-sell",
  from: 8.2,
  to: 33.6,
  rate: 4.25,
  pointer: false,
  moves: [
    { at: 8.2, x: 960, y: 160, zoom: 1.75 },
    { at: 8.4, dur: 4.5, x: 960, y: 540, zoom: 1.0 },
  ],
};
const FILL: Cut = {
  take: "03-sell",
  from: 33.6,
  hold: 1,
  pointer: false,
  moves: [
    { at: 33.6, x: 760, y: 300, zoom: 1.35 },
    // on the toast before it turns: the fill lands on a still frame
    { at: 35.1, dur: 0.7, x: 960, y: 180, zoom: 1.85 },
  ],
};
const CERTIFICATE: Cut = {
  take: "04-certificate",
  hold: 0.5,
  moves: [
    { at: 0, x: 640, y: 800, zoom: 1.3 },
    { at: 1.75, dur: 0.9, x: 960, y: 540, zoom: 1.36 },
  ],
};
const RECEIPT: Cut = {
  take: "05-receipt",
  to: 3.02,
  hold: 3.5,
  pointer: false,
  moves: [
    { at: 0, x: 780, y: 300, zoom: 1.5 },
    { at: 1.3, dur: 1.2, x: 960, y: 505, zoom: 1.42 },
  ],
};
const CUTS = [ARRIVE, SIGN_IN, SELL, WAIT, FILL, CERTIFICATE, RECEIPT];
const starts = CUTS.reduce<number[]>((acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + shotFrames(CUTS[i - 1]!)], []);
export const LIVE_FRAMES = starts.at(-1)! + shotFrames(RECEIPT);
export const LIVE_SECONDS = LIVE_FRAMES / s(1);
const startOf = (cut: Cut) => starts[CUTS.indexOf(cut)]! / FPS;
/** Seconds into the scene of what the sound lands on: the seal, the fill (the drop), the certificate, the receipt. */
export const LIVE_CUES = {
  signIn: startOf(SIGN_IN),
  sell: startOf(SELL),
  sealed: startOf(SELL) + (5.9 - (SELL.from ?? 0)),
  wait: startOf(WAIT),
  drop: startOf(FILL) + (36.06 - (FILL.from ?? 0)),
  certificate: startOf(CERTIFICATE),
  receipt: startOf(RECEIPT),
};

export const Live = () => {
  const f = useCurrentFrame();
  const at = (cut: Cut) => starts[CUTS.indexOf(cut)]!;
  const local = (cut: Cut) => (f - at(cut)) / FPS;
  return (
    <AbsoluteFill style={{ background: C.deep }}>
      {CUTS.map((cut) => (
        <Sequence key={`${cut.take}-${cut.from ?? 0}`} from={at(cut)} durationInFrames={shotFrames(cut)}>
          <Shot
            {...cut}
            over={({ t, at: point }) => {
              if (cut === ARRIVE) {
                const show = ramp(t, 0.5, 1.3);
                return (
                  <div style={{ ...plate, position: "absolute", left: 80, bottom: 80, padding: "22px 30px 26px", opacity: show, transform: `translateY(${(1 - show) * 12}px)` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: F.text, fontSize: 21, letterSpacing: "0.16em", color: C.ink2 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 5, background: C.buy, boxShadow: `0 0 0 4px color-mix(in oklch, ${C.buy} 25%, transparent)` }} />
                      LIVE ON MONAD MAINNET
                    </div>
                    <div style={{ fontFamily: F.display, fontSize: 58, color: C.ink, marginTop: 8 }}>unisonfi.com</div>
                  </div>
                );
              }
              if (cut === SELL) {
                // as the order's row turns "Sealed": the block it was sealed in, from the chain
                const [x, y] = point(552, 892);
                const show = ramp(t, 6.0, 6.5) * interpolate(t, [6.95, 7.2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                return <Callout x={x + 14} y={y} dx={56} text={`SEALED IN BLOCK ${S.upTo.toLocaleString("en-US")} · ${S.sealedAt} UTC`} show={show} />;
              }
              if (cut === WAIT) return <SealTimeline now={clockOf("03-sell", t)} show={ramp(t, 9.0, 13.0)} />;
              if (cut === FILL) {
                // the chime: the toast's own outline rings outward as the page shows the fill
                const ring = interpolate(t, [36.06, 36.9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                const grow = 30 * settle(ring);
                const [x0, y0] = point(782 - grow, 68 - grow);
                const [x1, y1] = point(1138 + grow, 155 + grow);
                return (
                  <>
                    <SealTimeline now={clockOf("03-sell", t)} show={interpolate(local(cut), [0, 0.6], [1, 0], { extrapolateRight: "clamp" })} />
                    {ring > 0 && ring < 1 ? (
                      <div
                        style={{
                          position: "absolute",
                          left: x0,
                          top: y0,
                          width: x1 - x0,
                          height: y1 - y0,
                          borderRadius: 30,
                          border: `1.5px solid color-mix(in oklch, ${C.buy} 70%, transparent)`,
                          boxShadow: `0 0 48px color-mix(in oklch, ${C.buy} 40%, transparent), inset 0 0 28px color-mix(in oklch, ${C.buy} 18%, transparent)`,
                          opacity: (1 - ring) ** 1.5,
                        }}
                      />
                    ) : null}
                  </>
                );
              }
              if (cut === RECEIPT) {
                // "13 s later", underlined as it is read
                const [x0, y0] = point(1004, 497);
                const [x1] = point(1068, 497);
                const draw = Math.max(ramp(t, 2.4, 3.0), ramp(local(cut), 3.4, 4.0));
                return <div style={{ position: "absolute", left: x0, top: y0 + 2, width: (x1 - x0) * draw, height: 3, background: C.accent, boxShadow: `0 0 12px ${C.glow}` }} />;
              }
              return null;
            }}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
