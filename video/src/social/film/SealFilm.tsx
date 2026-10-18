import type { ReactNode } from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { F, FPS, s, settle } from "../../brand";
import live from "../../data/challenge-live.json";
import made from "../../data/seal-audio.json";
import { Flash, Words } from "../../kit/Fx";
import { WaitDial } from "../cards";
import { LIGHT } from "../horology/materials";
import { Paper } from "../horology/Paper";
import { Studio } from "../horology/Studio";
import { Ribbon, WaxSeal } from "../horology/WaxSeal";
import { Arcs, Digits, onSheet, Reticle, shake, Stamp, type Sheet } from "./parts";

/**
 * "We built a bot to snipe our own exchange." The X film: square, 26 s, made to loop. The same sniper against both
 * markets: the old rule's seal breaks and its pot was paid; Unison's holds through every fill. Every number is the
 * contracts' own (src/data/challenge-live.json, read at render). The last frame is the first frame's set, so the loop
 * is seamless.
 */
export const SEAL_FILM = { fps: FPS, width: 1080, height: 1080, seconds: 26 };

const day = LIGHT.porcelain;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const useT = () => useCurrentFrame() / FPS;
const HEAD = { fontFamily: F.display, color: day.ink, lineHeight: 1.02, letterSpacing: "-0.01em", whiteSpace: "nowrap" } as const;

/** the beats, in seconds of the film */
const B = { two: 3, old: 4, unison: 9, why: 15.5, end: 21, done: 26 };

/** A shot: it arrives on a push (1.06× and a little blur, settled in 0.18 s), then drifts. */
function Shot({ children, enter = true, from = 1, to = 1.045, over = 6 }: { children: ReactNode; enter?: boolean; from?: number; to?: number; over?: number }) {
  const t = useT();
  const e = enter ? settle(clamp01(t / 0.18)) : 1;
  const k = (1 + 0.06 * (1 - e)) * (from + (to - from) * clamp01(t / over));
  return <AbsoluteFill style={{ transform: `scale(${k})`, filter: e < 1 ? `blur(${(1 - e) * 8}px)` : undefined }}>{children}</AbsoluteFill>;
}

const SHEET_U: Sheet = { x: 230, y: 540, w: 1000, h: 620, rotate: -4 };
const SHEET_U2: Sheet = { x: 150, y: 560, w: 1000, h: 620, rotate: -3 };
const SHEET_O: Sheet = { x: -130, y: 470, w: 1000, h: 620, rotate: 3 };
const SEAL_U = { x: 665, y: 295 };
const SEAL_O = { x: 810, y: 400 };

function UnisonSheet({ sh, jitter = { x: 0, y: 0 } }: { sh: Sheet; jitter?: { x: number; y: number } }) {
  return (
    <Paper x={sh.x} y={sh.y} w={sh.w} h={sh.h} rotate={sh.rotate}>
      <div style={{ position: "absolute", left: 78, top: 66, fontFamily: F.displaySmall, fontWeight: 550, fontSize: 50, color: day.ink }}>Unison</div>
      {/* where to take the pot, engraved on the certificate: on screen in every Unison shot */}
      <div style={{ position: "absolute", left: 80, top: 146, fontFamily: F.text, fontWeight: 600, fontSize: 30, color: day.ink }}>unisonfi.com/challenge</div>
      <div style={{ position: "absolute", left: 80, top: 188, fontFamily: F.text, fontSize: 25, color: day.ink2 }}>Live on Monad · priced by Chainlink</div>
      <Ribbon x={SEAL_U.x} y={SEAL_U.y - 14} length={300} width={64} spread={[24, -18]} />
      <WaxSeal x={SEAL_U.x + jitter.x} y={SEAL_U.y + jitter.y} size={300} rotate={-6} seed={4} />
    </Paper>
  );
}

/** 0–3 s. The hook, on frame 0: the reticle finds Unison's seal. */
function Hook() {
  const t = useT();
  const c = onSheet(SHEET_U, SEAL_U.x, SEAL_U.y);
  const m = settle(clamp01(t / 1.15));
  const lock = settle(clamp01((t - 1.2) / 0.22));
  return (
    <Studio finish="porcelain" keyX={24} keyY={14}>
      <Shot enter={false}>
        <UnisonSheet sh={SHEET_U} />
        {/* already entering on frame 0: the first thing the feed shows is the sniper's sight */}
        <Reticle x={1150 + (c.x - 1150) * m} y={420 + (c.y - 420) * m} lock={lock} rot={(1 - m) * 25} />
      </Shot>
      <div style={{ position: "absolute", left: 64, top: 70, ...HEAD, fontSize: 104 }}>
        <div>We built a bot</div>
        <div>
          <Words text="to snipe our" at={0.45} />
        </div>
        <div>
          <Words text="own exchange." at={0.75} />
        </div>
      </div>
    </Studio>
  );
}

/** 3–4 s. Same bot, two rules: both sheets, both seals still whole. */
function TwoRules() {
  const L: Sheet = { x: 40, y: 500, w: 480, h: 300, rotate: -4 };
  const R: Sheet = { x: 560, y: 480, w: 480, h: 300, rotate: 3 };
  const sheet = (sh: Sheet, name: string, seed: number) => (
    <Paper x={sh.x} y={sh.y} w={sh.w} h={sh.h} rotate={sh.rotate} periods={34}>
      <div style={{ position: "absolute", left: 46, top: 44, fontFamily: F.displaySmall, fontWeight: 550, fontSize: 34, color: day.ink }}>{name}</div>
      <Ribbon x={340} y={180} length={150} width={34} spread={[24, -18]} />
      <WaxSeal x={340} y={186} size={150} rotate={-6} seed={seed} />
    </Paper>
  );
  return (
    <Studio finish="porcelain" keyX={24} keyY={14}>
      <Shot>
        {sheet(L, "Old rule", 9)}
        {sheet(R, "Unison", 4)}
      </Shot>
      <div style={{ position: "absolute", left: 64, top: 80, ...HEAD, fontSize: 118 }}>
        <div>
          <Words text="Same bot." at={0} dur={0.3} />
        </div>
        <div>
          <Words text="Two rules." at={0.22} dur={0.3} />
        </div>
      </div>
    </Studio>
  );
}

/** 4–9 s. The old rule: the reticle locks, the seal breaks, the pot is paid. */
function OldRule() {
  const t = useT();
  const c = onSheet(SHEET_O, SEAL_O.x, SEAL_O.y);
  const m = settle(clamp01((t - 0.1) / 0.6));
  const lock = settle(clamp01((t - 0.6) / 0.2));
  const fire = 0.95;
  const crackDraw = clamp01((t - fire) / 0.1);
  const split = settle(clamp01((t - fire - 0.1) / 0.55));
  const fly = clamp01((t - fire - 0.1) / 0.75);
  const recoil = t > fire ? 1 + 0.08 * Math.max(0, 1 - (t - fire) / 0.15) : 1;
  const jolt = shake(t, fire, 9);
  const num = settle(clamp01((t - 2.55) / 0.35));
  return (
    <Studio finish="porcelain" keyX={24} keyY={14}>
      <Shot>
        <AbsoluteFill style={{ transform: `translate(${jolt.x}px, ${jolt.y}px)` }}>
          <Paper x={SHEET_O.x} y={SHEET_O.y} w={SHEET_O.w} h={SHEET_O.h} rotate={SHEET_O.rotate}>
            <div style={{ position: "absolute", left: 200, top: 66, fontFamily: F.displaySmall, fontWeight: 550, fontSize: 50, color: day.ink }}>Old rule</div>
            <div style={{ position: "absolute", left: 196, top: 132, opacity: num, transform: `translateY(${(1 - num) * 18}px)`, filter: num < 1 ? `blur(${(1 - num) * 8}px)` : undefined }}>
              <span style={{ fontFamily: F.display, fontSize: 118, color: day.ink, whiteSpace: "nowrap" }}>
                <span style={{ fontFamily: F.text, fontSize: 96, marginRight: 6, position: "relative", top: -6 }}>+</span>
                {live.control.bps.toFixed(2)}
                <span style={{ fontSize: 62, marginLeft: 14, color: day.ink2 }}>bp</span>
              </span>
              <div style={{ fontFamily: F.text, fontSize: 32, color: day.ink2, marginTop: 6 }}>edge over {live.control.fills} fills, after fees</div>
            </div>
            <Stamp t={t} at={2.25} x={455} y={470} size={250} />
            <Ribbon x={SEAL_O.x} y={SEAL_O.y - 14} length={300} width={64} spread={[30, -14]} />
            <WaxSeal x={SEAL_O.x} y={SEAL_O.y} size={300} rotate={8} seed={9} broken crackDraw={crackDraw} split={t < fire + 0.1 ? 0 : split} fly={t < fire + 0.1 ? 0 : fly} />
          </Paper>
          <Reticle x={-250 + (c.x + 250) * m} y={260 + (c.y - 260) * m} lock={lock} opacity={1 - clamp01((t - 1.25) / 0.4)} scale={recoil} rot={(1 - m) * -25} />
        </AbsoluteFill>
      </Shot>
      <div style={{ position: "absolute", left: 64, top: 64, ...HEAD, fontSize: 88 }}>
        <div>
          <Words text="On the old rule," at={0.15} />
        </div>
        <div>
          <Words text="it won." at={0.5} />
        </div>
        <div>
          <Words text="The contract paid it." at={2.3} />
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 27, color: day.ink2, marginTop: 18, opacity: clamp01((t - 3.0) / 0.3), letterSpacing: 0 }}>
          paid out 8 October · tx {live.control.claimTx.slice(0, 6)}…{live.control.claimTx.slice(-4)}
        </div>
      </div>
    </Studio>
  );
}

/** 9–15.5 s. Unison: strike after strike, the counter runs to the live count, and the seal holds. */
const STRIKES = Array.from({ length: 16 }, (_, k) => 0.9 + 4.3 * (k / 15) ** 0.6);
function UnisonHolds() {
  const t = useT();
  const c = onSheet(SHEET_U2, SEAL_U.x, SEAL_U.y);
  const m = settle(clamp01((t - 0.1) / 0.5));
  const lock = settle(clamp01((t - 0.5) / 0.2));
  const last = [...STRIKES].reverse().find((a) => a <= t);
  const since = last === undefined ? 9 : t - last;
  const jitter = since < 0.14 ? { x: 3 * (1 - since / 0.14) * Math.sin(since * 90), y: 2 * (1 - since / 0.14) } : { x: 0, y: 0 };
  const recoil = since < 0.12 ? 1 + 0.05 * (1 - since / 0.12) : 1;
  const count = Math.max(1, Math.round(live.unison.fills * clamp01((t - 0.9) / 4.3) ** 1.6));
  const bp = settle(clamp01((t - 5.3) / 0.3));
  const away = clamp01((t - 5.9) / 0.5);
  return (
    <Studio finish="porcelain" keyX={24} keyY={14}>
      <Shot>
        <UnisonSheet sh={SHEET_U2} jitter={jitter} />
        {STRIKES.map((a) => (
          <Arcs key={a} t={t} at={a} x={c.x} y={c.y} r0={150} r1={420} />
        ))}
        <Reticle x={1400 + (c.x - 1400) * m + away * 260} y={900 + (c.y - 900) * m - away * 120} lock={lock * (1 - away)} opacity={1 - away} scale={recoil} rot={(1 - m) * 25} />
      </Shot>
      <div style={{ position: "absolute", left: 64, top: 64, ...HEAD, fontSize: 88 }}>
        <div>
          <Words text="On Unison:" at={0.15} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 4, opacity: clamp01((t - 0.85) / 0.15) }}>
          <Digits value={count} size={200} />
          <span style={{ fontFamily: F.text, fontSize: 46, color: day.ink2 }}>fills</span>
          <span style={{ fontFamily: F.display, fontSize: 88, color: day.ink, marginLeft: 22, opacity: bp, transform: `scale(${0.9 + 0.1 * bp})`, display: "inline-block" }}>
            <span style={{ fontFamily: F.text, fontSize: 76, marginRight: 4, position: "relative", top: -4 }}>−</span>
            {Math.abs(live.unison.bps).toFixed(2)}
            <span style={{ fontSize: 48, marginLeft: 10, color: day.ink2 }}>bp</span>
          </span>
        </div>
        <div style={{ marginTop: 6 }}>
          <Words text="The seal held." at={5.45} />
        </div>
      </div>
    </Studio>
  );
}

/** 15.5–21 s. Why: the stopwatch, its hand running from the seal to the price, 18 s later. */
function Why() {
  const t = useT();
  const hand = 18 * settle(clamp01((t - 0.6) / 1.5));
  return (
    <Studio finish="porcelain" keyX={22} keyY={12}>
      <Shot>
        <WaitDial cx={600} cy={850} size={1000} handSec={hand} />
      </Shot>
      <div style={{ position: "absolute", left: 64, top: 56, ...HEAD, fontSize: 84 }}>
        <div>
          <Words text="You can't front-run" at={0.3} />
        </div>
        <div>
          <Words text="a price that doesn't" at={0.65} />
        </div>
        <div>
          <Words text="exist yet." at={1.0} />
        </div>
      </div>
    </Studio>
  );
}

/** 21–26 s. The pot, still sealed; the dare; then back to the hook's set, for the loop. */
function End() {
  const t = useT();
  const c = onSheet(SHEET_U, SEAL_U.x, SEAL_U.y);
  const out = 1 - clamp01((t - 4.55) / 0.4);
  const info = clamp01((t - 2.0) / 0.4) * out;
  return (
    <Studio finish="porcelain" keyX={24} keyY={14}>
      {/* the camera pulls back to exactly the hook's framing by the last frame */}
      <Shot from={1.04} to={1} over={5}>
        <UnisonSheet sh={SHEET_U} />
        <Arcs t={t} at={1.5} x={c.x} y={c.y} r0={170} r1={500} dur={1.1} />
        <Arcs t={t} at={1.66} x={c.x} y={c.y} r0={170} r1={460} dur={1.1} />
      </Shot>
      <div style={{ position: "absolute", left: 64, top: 64, ...HEAD, opacity: out }}>
        <div style={{ fontSize: 120 }}>
          <Words text={`${live.unison.pot} AUSD.`} at={0.2} dur={0.4} />
        </div>
        <div style={{ fontSize: 120 }}>
          <Words text="Still sealed." at={0.7} />
        </div>
        <div style={{ fontSize: 150, marginTop: 10 }}>
          <Words text="Snipe us." at={1.5} dur={0.4} />
        </div>
      </div>
      <div style={{ position: "absolute", right: 64, top: 74, fontFamily: F.text, fontSize: 22, color: day.ink3, opacity: info }}>
        Scores as of {new Date(live.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}
      </div>
    </Studio>
  );
}

/** The sound, from src/data/seal-audio.json (scripts/seal-audio.mjs): the narrator, the made effects and the score where
 *  they exist, the house library where they don't, so the film always renders. The score ducks under the voice. */
type Made = { voice: { id: string; at: number; file: string; seconds: number }[]; sfx: Record<string, string>; music: string | null };
const M = made as Made;
function SealAudio() {
  const at = (sec: number, file: string, volume = 1, len?: number) => (
    <Sequence key={`${file}-${sec}`} from={s(sec)} durationInFrames={len ? s(len) : undefined}>
      <Audio src={staticFile(`audio/${file}`)} volume={volume} />
    </Sequence>
  );
  const fx = (name: string, fallback: string | null) => M.sfx[name] ?? fallback;
  const f = useCurrentFrame();
  const t = f / FPS;
  const speaking = M.voice.some((v) => t >= v.at - 0.1 && t <= v.at + v.seconds + 0.15);
  const bed = speaking ? 0.14 : 0.3;
  const music = Math.min(bed, interpolate(f, [0, s(0.4), s(B.done - 0.8), s(B.done)], [0, 0.3, 0.3, 0], { extrapolateRight: "clamp" }));
  const cue = (sec: number, name: string, fallback: string | null, volume = 1) => {
    const file = fx(name, fallback);
    return file ? at(sec, file, volume) : null;
  };
  return (
    <>
      <Audio src={staticFile(`audio/${M.music ?? "music-demo.mp3"}`)} volume={music} />
      {M.sfx.ticking ? at(0, M.sfx.ticking, 0.4, B.two) : [0, 0.5, 1.0].map((a) => at(a, "sfx-tick.mp3", 0.45))}
      {cue(1.3, "lock", "sfx-shutter.mp3", 0.7)}
      {[B.two, B.old, B.unison, B.why, B.end].map((a) => at(a - 0.08, "sfx-whoosh.mp3", 0.45))}
      {cue(B.old + 0.6, "lock", "sfx-shutter.mp3", 0.7)}
      {cue(B.old + 0.95, "crack", "sfx-seal.mp3", 1)}
      {cue(B.old + 1.05, "chips", null, 0.7)}
      {cue(B.old + 2.25, "stamp", "sfx-seal.mp3", 0.95)}
      {cue(B.unison + 0.5, "lock", "sfx-shutter.mp3", 0.7)}
      {STRIKES.map((a) => cue(B.unison + a, "strike", "sfx-tick.mp3", 0.55))}
      {cue(B.end + 1.5, "fork", "sfx-chime.mp3", 0.85)}
      {M.voice.map((v) => at(v.at, v.file, 1))}
    </>
  );
}

export const SealFilm = () => (
  <AbsoluteFill style={{ background: day.ground }}>
    <Sequence durationInFrames={s(B.two)}>
      <Hook />
    </Sequence>
    <Sequence from={s(B.two)} durationInFrames={s(B.old - B.two)}>
      <TwoRules />
    </Sequence>
    <Sequence from={s(B.old)} durationInFrames={s(B.unison - B.old)}>
      <OldRule />
    </Sequence>
    <Sequence from={s(B.unison)} durationInFrames={s(B.why - B.unison)}>
      <UnisonHolds />
    </Sequence>
    <Sequence from={s(B.why)} durationInFrames={s(B.end - B.why)}>
      <Why />
    </Sequence>
    <Sequence from={s(B.end)} durationInFrames={s(B.done - B.end)}>
      <End />
    </Sequence>
    {[B.two, B.old, B.unison, B.why, B.end].map((a) => (
      <Sequence key={a} from={s(a)} durationInFrames={s(0.3)}>
        <Flash at={0} peak={0.22} dur={0.24} />
      </Sequence>
    ))}
    <SealAudio />
  </AbsoluteFill>
);
