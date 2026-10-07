import type { ReactNode } from "react";
import { AbsoluteFill, Freeze, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { C, FPS, H, W } from "../brand";
import footage from "../data/footage.json";

/**
 * The live product on screen: a take recorded by capture/live.mjs from www.unisonfi.com on mainnet, played through
 * a camera that glides between the controls being used, with the cursor drawn where the capture clicked. Nothing on
 * the page is redrawn: the camera only frames it.
 */
export interface Click {
  /** seconds from the take's first frame */
  at: number;
  /** the viewport's CSS pixels */
  x: number;
  y: number;
  label: string;
}
interface Take {
  file: string;
  seconds: number;
  capturedAt: string;
  clicks: Click[];
  /** the capture's viewport, when it isn't the film's 1920 × 1080 */
  viewport?: { width: number; height: number };
}
export type TakeName = keyof typeof footage;
export const TAKES = footage as Record<TakeName, Take>;

/** Where the camera looks: a point of the page (CSS pixels) at the centre of the frame, and how close. */
export interface Cam {
  x: number;
  y: number;
  zoom: number;
}
/** From `at` (seconds of the take), the camera glides over `dur` seconds to this framing. */
export interface Move extends Cam {
  at: number;
  dur?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** a camera operator's ease: slow off the mark, slow into the mark */
const glide = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);

export function cameraAt(moves: Move[], t: number, page: { width: number; height: number }): Cam {
  const [first, ...rest] = moves;
  if (!first) return { x: page.width / 2, y: page.height / 2, zoom: 1 };
  let cam: Cam = { x: first.x, y: first.y, zoom: first.zoom };
  for (const m of rest) {
    const p = glide(clamp01((t - m.at) / (m.dur ?? 0.9)));
    if (p <= 0) break;
    // zoom moves in ratios, so a push from 1× to 2× feels as even as one from 2× to 4×
    cam = { x: lerp(cam.x, m.x, p), y: lerp(cam.y, m.y, p), zoom: Math.exp(lerp(Math.log(cam.zoom), Math.log(m.zoom), p)) };
  }
  // never past the page's edge
  const halfW = page.width / (2 * cam.zoom);
  const halfH = page.height / (2 * cam.zoom);
  return {
    zoom: cam.zoom,
    x: cam.zoom <= 1 ? page.width / 2 : Math.min(page.width - halfW, Math.max(halfW, cam.x)),
    y: cam.zoom <= 1 ? page.height / 2 : Math.min(page.height - halfH, Math.max(halfH, cam.y)),
  };
}

/** Where a point of the page lands in the frame, for a callout drawn over it. */
export const project = (cam: Cam, page: { width: number }, x: number, y: number): [number, number] => {
  const k = W / page.width;
  return [W / 2 + (x - cam.x) * k * cam.zoom, H / 2 + (y - cam.y) * k * cam.zoom];
};

/** The pointer, gliding to each control just before the capture clicked it; a ring where it pressed. */
function Pointer({ clicks, t }: { clicks: Click[]; t: number }) {
  const first = clicks[0];
  const last = clicks.at(-1);
  if (!first || !last) return null;
  let x = first.x + 240;
  let y = first.y + 150;
  for (let i = 0; i < clicks.length; i++) {
    const c = clicks[i]!;
    const prev = clicks[i - 1];
    const travel = Math.min(0.55, prev ? (c.at - prev.at) * 0.7 : 0.55);
    const p = glide(clamp01((t - (c.at - travel)) / travel));
    if (p <= 0) break;
    x = lerp(prev ? prev.x : first.x + 240, c.x, p);
    y = lerp(prev ? prev.y : first.y + 150, c.y, p);
  }
  const opacity = interpolate(t, [first.at - 0.55, first.at - 0.25, last.at + 1.4, last.at + 1.9], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const press = clicks.find((c) => t >= c.at && t < c.at + 0.6);
  const since = press ? t - press.at : 1;
  const squeeze = press ? interpolate(since, [0, 0.07, 0.2], [1, 0.84, 1], { extrapolateRight: "clamp" }) : 1;
  const ring = press ? clamp01((since - 0.04) / 0.5) : 1;
  return (
    <>
      {press && ring < 1 ? (
        <div
          style={{
            position: "absolute",
            left: press.x - 30 * ring,
            top: press.y - 30 * ring,
            width: 60 * ring,
            height: 60 * ring,
            borderRadius: "50%",
            border: `2px solid ${C.accent}`,
            opacity: (1 - ring) * 0.85,
          }}
        />
      ) : null}
      <svg
        width={26}
        height={34}
        viewBox="0 0 26 34"
        style={{ position: "absolute", left: x - 3, top: y - 2, opacity, transform: `scale(${squeeze})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.55))" }}
      >
        <path d="M3 2 L3 26 L9.2 20.6 L13.4 30.6 L17.6 28.8 L13.5 19 L21.8 19 Z" fill="white" stroke="oklch(0.2 0.01 265)" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </>
  );
}

/**
 * One shot of a take: its seconds [from, to) played at `rate`, then its last frame held for `hold` seconds. Length:
 * shotFrames(...). `over` draws in the frame's own space, given where the camera is.
 */
export function Shot({
  take,
  from = 0,
  to,
  rate = 1,
  moves = [],
  pointer = true,
  over,
}: {
  take: TakeName;
  from?: number;
  to?: number;
  rate?: number;
  hold?: number;
  moves?: Move[];
  pointer?: boolean;
  over?: (now: { cam: Cam; t: number; at: (x: number, y: number) => [number, number] }) => ReactNode;
}) {
  const f = useCurrentFrame();
  const T = TAKES[take];
  const page = T.viewport ?? { width: W, height: H };
  const played = Math.max(1, Math.round((((to ?? T.seconds) - from) / rate) * FPS));
  const shown = Math.min(f, played - 1);
  const t = from + (shown / FPS) * rate;
  const cam = cameraAt(moves, t, page);
  const k = W / page.width;
  return (
    <AbsoluteFill style={{ background: C.deep, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: page.width,
          height: page.height,
          transformOrigin: "0 0",
          transform: `translate(${W / 2 - cam.x * k * cam.zoom}px, ${H / 2 - cam.y * k * cam.zoom}px) scale(${k * cam.zoom})`,
        }}
      >
        <Freeze frame={played - 1} active={f >= played}>
          <OffthreadVideo src={staticFile(T.file)} trimBefore={Math.round(from * FPS)} playbackRate={rate} muted style={{ width: page.width, height: page.height }} />
        </Freeze>
        {pointer ? <Pointer clicks={T.clicks} t={t} /> : null}
      </div>
      {over?.({ cam, t, at: (x, y) => project(cam, page, x, y) })}
    </AbsoluteFill>
  );
}

/** A shot's length in frames: what it plays, then what it holds. */
export const shotFrames = ({ take, from = 0, to, rate = 1, hold = 0 }: { take: TakeName; from?: number; to?: number; rate?: number; hold?: number }) =>
  Math.max(1, Math.round((((to ?? TAKES[take].seconds) - from) / rate) * FPS)) + Math.round(hold * FPS);
