import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { C, F, FPS, s, settle } from "../brand";
import { FILM_SALE as S } from "../data/chain";
import { useLine } from "../kit/Plan";
import { type Move, Shot, shotFrames, TAKES, type TakeName } from "../kit/Screen";

/**
 * The live product, on mainnet (demo 0:45–1:35): www.unisonfi.com, a passkey, a sealed sell of 9 WMON, the wait
 * for Chainlink's next observation, the fill, its certificate and its receipt. Every frame of the page is the
 * capture's (capture/live.mjs and capture/pages.mjs, 7 October 2026, at 4K); the film adds a camera, the pointer,
 * and the chain's own times.
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
// a label past the rail's middle hangs to the left of its stop, so neighbours near the end don't collide
const STOPS = [
  { at: S.sealedAt, label: "Sealed", sub: `block ${S.upTo.toLocaleString("en-US")}`, color: C.ink },
  { at: S.observedAt, label: "Chainlink observes", sub: `$${S.reference}`, color: C.accent },
  { at: S.clearedAt, label: "Cleared, one price", sub: `$${S.price}`, color: C.buy },
].map((stop) => ({ ...stop, right: rx(stop.at) > RX0 + 0.6 * (RX1 - RX0) }));
// the two gaps, from the sale's own times: how long its price didn't exist, and how long the report took to land
const GAPS = [
  { from: S.sealedAt, to: S.observedAt, text: `${utc(S.observedAt) - utc(S.sealedAt)} s: its price doesn't exist yet` },
  { from: S.observedAt, to: S.landedAt, text: `${utc(S.landedAt) - utc(S.observedAt)} s: the signed report lands on chain` },
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

// Moments in the 4K takes of 7 October (src/data/footage.json; clicks are logged there). The sign-in take opens on
// the market signed out, its vault's quote in by 0.15 s. The sell is confirmed at 5.28 s; nothing in the orders
// changes until its row appears, "Sealed · waits for Chainlink", at 7.17 s. The page shows the new reference and the
// trade from 69 s, and the toast turns "Sold" at 72.4 s. The receipt has scrolled to "Check it yourself" by 3.84 s.
// Scrolls are cut, not shown: the 4K screencast paints them at about 16 frames a second.
const AT = { arrive: 0.16, confirmed: 5.95, resume: 7.0, sealedRow: 7.17, waitFrom: 10.4, waitEnd: 69.0, sold: 72.4, checkIt: 3.84 };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// The arrival is the sign-in take's own first frame, held while the camera settles; the take then carries on into
// the sign-in, so arriving and signing in read as one shot.
const ARRIVE: Cut = {
  take: "02-signin",
  from: AT.arrive,
  to: AT.arrive + 0.02,
  hold: 3.9,
  pointer: false,
  moves: [
    { at: AT.arrive, x: 960, y: 540, zoom: 1 },
    { at: AT.arrive + 0.15, dur: 3.6, x: 960, y: 470, zoom: 1.06 },
  ],
};
const SIGN_IN: Cut = {
  take: "02-signin",
  from: AT.arrive + 0.02,
  rate: 1.3,
  hold: 0.5,
  moves: [
    { at: AT.arrive + 0.02, x: 960, y: 470, zoom: 1.06 },
    { at: 1.0, dur: 0.9, x: 960, y: 545, zoom: 1.34 },
  ],
};
const SELL: Cut = {
  take: "03-sell",
  from: 0.3,
  to: AT.confirmed,
  rate: 1.1,
  moves: [
    { at: 0.3, x: 960, y: 540, zoom: 1 },
    { at: 0.32, dur: 0.75, x: 1586, y: 500, zoom: 1.3 },
    // confirmed: down to the orders, where it is about to appear
    { at: 5.33, dur: 0.6, x: 760, y: 860, zoom: 1.55 },
  ],
};
// the signature and the relay change nothing in this frame, so the cut skips to just before the row arrives; the
// camera stays on the row while the voice says "right here, in this block"
const SEALED: Cut = {
  take: "03-sell",
  from: AT.resume,
  to: AT.waitFrom,
  pointer: false,
  moves: [
    { at: AT.resume, x: 760, y: 860, zoom: 1.55 },
    { at: AT.resume + 0.1, dur: 3.3, x: 700, y: 870, zoom: 1.66 },
  ],
};
const WAIT: Cut = {
  take: "03-sell",
  from: AT.waitFrom,
  to: AT.waitEnd,
  rate: 10,
  pointer: false,
  moves: [
    { at: AT.waitFrom, x: 700, y: 870, zoom: 1.66 },
    // twelve seconds of the take: 1.2 s on screen at ten times speed
    { at: AT.waitFrom + 0.3, dur: 12, x: 960, y: 540, zoom: 1.0 },
  ],
};
const FILL: Cut = {
  take: "03-sell",
  from: AT.waitEnd,
  hold: 1,
  pointer: false,
  moves: [
    { at: AT.waitEnd, x: 760, y: 300, zoom: 1.35 },
    // on the toast before it turns: the fill lands on a still frame
    { at: AT.sold - 0.9, dur: 0.7, x: 960, y: 180, zoom: 1.85 },
  ],
};
const CERTIFICATE: Cut = {
  take: "04-certificate",
  to: 6.4,
  hold: 0.3,
  moves: [
    { at: 0, x: 640, y: 800, zoom: 1.3 },
    { at: 2.1, dur: 0.9, x: 960, y: 540, zoom: 1.36 },
  ],
};
// the receipt's first frames held while the voice reads its times (the camera's second move follows the voice)
const RECEIPT: Cut = {
  take: "05-receipt",
  to: 2.95,
  hold: 4.0,
  pointer: false,
  moves: [
    { at: 0, x: 780, y: 300, zoom: 1.5 },
    { at: 1.6, dur: 1.0, x: 960, y: 505, zoom: 1.55 },
  ],
};
// then "Check it yourself": the commands that rebuild this auction from the chain alone, into the verifier's scene
const CHECK_IT: Cut = {
  take: "05-receipt",
  from: AT.checkIt,
  hold: 2.3,
  pointer: false,
  moves: [
    { at: AT.checkIt, x: 960, y: 410, zoom: 1.56 },
    { at: AT.checkIt + 0.05, dur: 2.7, x: 960, y: 410, zoom: 1.66 },
  ],
};
const CUTS = [ARRIVE, SIGN_IN, SELL, SEALED, WAIT, FILL, CERTIFICATE, RECEIPT, CHECK_IT];
const starts = CUTS.reduce<number[]>((acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + shotFrames(CUTS[i - 1]!)], []);
export const LIVE_FRAMES = starts.at(-1)! + shotFrames(CUTS.at(-1)!);
export const LIVE_SECONDS = LIVE_FRAMES / s(1);
const startOf = (cut: Cut) => starts[CUTS.indexOf(cut)]! / FPS;
/** Seconds into the scene of what the sound lands on: the seal, the fill (the drop), the certificate, the receipt. */
export const LIVE_CUES = {
  signIn: startOf(SIGN_IN),
  sell: startOf(SELL),
  sealed: startOf(SEALED) + (AT.sealedRow - AT.resume),
  wait: startOf(WAIT),
  drop: startOf(FILL) + (AT.sold - AT.waitEnd),
  certificate: startOf(CERTIFICATE),
  receipt: startOf(RECEIPT),
};

/** A line drawn under a few words of the page as the voice says them. */
function Underline({ from, to, draw }: { from: [number, number]; to: [number, number]; draw: number }) {
  return <div style={{ position: "absolute", left: from[0], top: from[1] + 2, width: (to[0] - from[0]) * draw, height: 3, background: C.accent, boxShadow: `0 0 12px ${C.glow}` }} />;
}

export const Live = () => {
  const f = useCurrentFrame();
  const at = (cut: Cut) => starts[CUTS.indexOf(cut)]!;
  const local = (cut: Cut) => (f - at(cut)) / FPS;
  // demo-07 on the receipt: "the seal…", then "then its price — observed forty-nine seconds later", each time
  // underlined as it is said, and the camera on the three times before the first (seconds of the receipt's take)
  const r0 = startOf(RECEIPT);
  const seal = useLine("demo-07", 1, r0 + 2.6) - r0;
  const price = useLine("demo-07", 2, r0 + 4.2) - r0;
  const moves = (cut: Cut): Move[] => (cut === RECEIPT ? [cut.moves[0]!, { ...cut.moves[1]!, at: Math.max(0.6, seal - 1.1) }] : cut.moves);
  return (
    <AbsoluteFill style={{ background: C.deep }}>
      {CUTS.map((cut) => (
        <Sequence key={`${cut.take}-${cut.from ?? 0}`} from={at(cut)} durationInFrames={shotFrames(cut)}>
          <Shot
            {...cut}
            moves={moves(cut)}
            over={({ t, at: point }) => {
              if (cut === ARRIVE) {
                // in as the page settles, out before the pointer comes for "Sign in"
                const show = ramp(t, 0.5, 1.3) * (1 - ramp(t, 3.45, 3.95));
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
              if (cut === SEALED) {
                // as the order's row appears: the block it was sealed in, from the chain
                const [x, y] = point(552, 892);
                const show = ramp(t, AT.sealedRow + 0.08, AT.sealedRow + 0.55) * (1 - ramp(t, AT.waitFrom - 0.35, AT.waitFrom));
                return <Callout x={x + 14} y={y} dx={56} text={`SEALED IN BLOCK ${S.upTo.toLocaleString("en-US")} · ${S.sealedAt} UTC`} show={show} />;
              }
              if (cut === WAIT) return <SealTimeline now={clockOf("03-sell", t)} show={ramp(t, AT.waitFrom + 0.1, AT.waitFrom + 11.6)} />;
              if (cut === FILL) {
                // the chime: the toast's own outline rings outward as the page shows the fill
                const ring = interpolate(t, [AT.sold, AT.sold + 0.84], [0, 1], clamp);
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
                // the seal's time (card 1) on "the seal…", then "49 s later" (card 2) on "forty-nine seconds later"
                return (
                  <>
                    <Underline from={point(562, 497)} to={point(656, 497)} draw={ramp(t, seal + 0.05, seal + 0.6)} />
                    <Underline from={point(1007, 497)} to={point(1072, 497)} draw={ramp(t, price + 1.0, price + 1.6)} />
                  </>
                );
              }
              return null;
            }}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
