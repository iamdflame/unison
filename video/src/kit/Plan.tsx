import { type ComponentType, createContext, type ReactNode, useContext } from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { FPS, s } from "../brand";
import align from "../data/align.json";
import script from "../data/script.json";
import { type Cue, Captions } from "./Captions";
import { Grain } from "./Grain";

/**
 * A film as a list of beats. Each beat is a scene, with the voice files that play over it and where; a beat lasts
 * as long as its scene or its voice, whichever is longer. Voice, music and effects come from public/audio/ (your
 * ElevenLabs files, see SCRIPT.md); any file not there yet is left out, its length estimated, so the cut always
 * plays. Captions come from SCRIPT.md (src/data/script.json), timed across each file's real length.
 */
export type VoiceId = keyof typeof script;
export interface Beat {
  id: string;
  Scene: ComponentType;
  /** the scene's own length: its animation is timed to this */
  seconds: number;
  /** the scene's timeline is fixed (footage): a voice must fit, the beat doesn't stretch */
  fixed?: boolean;
  /** each file from second `at` of the beat; or placed so that its line `line` lands on second `on`; `captions`: only
   * these lines get captions (the rest are on screen in the scene's own type) */
  voice?: (({ id: VoiceId; at: number } | { id: VoiceId; line: number; on: number }) & { captions?: number[] })[];
  /** effects: a file in public/audio and the second of the beat it lands on; with `voice`, `at` seconds after line
   * `line` of that voice in this beat, so an effect stays on its word when a take is re-recorded */
  sfx?: { file: string; at: number; volume?: number; voice?: VoiceId; line?: number }[];
  /** false when the scene sets the narration in its own type: no captions under it */
  captions?: boolean;
}
export interface Planned {
  /** frames */
  from: number;
  length: number;
  /** each voice file, and when each of its lines starts (seconds of the beat) */
  voices: { id: VoiceId; from: number; seconds: number; real: boolean; lines: number[] }[];
  sfx: { file: string; from: number; volume: number }[];
}
/**
 * A music file placed on the film's moments rather than from its first second. Its own landmarks (seconds of the
 * file, measured once from its loudness) land on seconds of named beats: its drop on the film's drop, and its ending,
 * the file's own run into its last hit, `lead` seconds long, spliced in so that hit lands on the film's last moment.
 */
export interface MusicSync {
  file: string;
  /** the music's level against the voice: 1 as the demo has it */
  gain?: number;
  /** the drop lands on second `at` of beat `beat`, or `at` seconds after line `line` of that beat's voice `voice` */
  drop?: { track: number; beat: string; at: number; voice?: VoiceId; line?: number };
  /** the ending's hit lands on second `at` of beat `beat`, or `at` seconds after line `line` of that beat's voice `voice` */
  end?: { track: number; lead: number; beat: string; at: number; voice?: VoiceId; line?: number };
}
/** A stretch of the music: from second `at` to `until` of the film, playing the file from its second `from`. */
export interface MusicCut {
  at: number;
  until: number;
  from: number;
  fadeIn: number;
  fadeOut: number;
  /** how far the voice ducks it: 1 fully, 0 not at all (a final hit rings over the last words) */
  duck: number;
  gain?: number;
}
export interface PlanProps {
  beats: Planned[];
  music: string | null;
  musicCuts?: MusicCut[];
  cues: Cue[];
  [key: string]: unknown;
}

/** A file's length in seconds, or null while it isn't in public/audio yet. */
const lengthOf = async (file: string) => {
  try {
    return await getAudioDurationInSeconds(staticFile(`audio/${file}`));
  } catch {
    return null;
  }
};

/** Without the file: words at 2.6 a second, plus the script's own pauses. */
const estimate = (id: VoiceId) => script[id].reduce((sum, seg) => sum + seg.text.split(/\s+/).length / 2.6 + seg.pause, 0.3);

/** Each take as it was really spoken (capture/align.mjs): when each line starts and ends, in seconds of the file. */
const ALIGNED = align as Partial<Record<string, { seconds: number; lines: { from: number; to: number }[] }>>;

/**
 * Each line of a voice file: when it starts and ends. From the take itself when it has been aligned (and the file is
 * still that take), otherwise from the script, each line its share of the speaking time by length.
 */
function linesOf(id: VoiceId, start: number, seconds: number) {
  const segs = script[id];
  const real = ALIGNED[id];
  if (real && real.lines.length === segs.length && Math.abs(real.seconds - seconds) < 0.15)
    return segs.map((seg, i) => ({ from: start + real.lines[i]!.from, to: start + real.lines[i]!.to, pause: seg.pause, text: seg.text }));
  const pauses = segs.reduce((p, x) => p + x.pause, 0);
  const speech = Math.max(0.5, seconds - pauses - 0.25);
  const weight = segs.reduce((w, x) => w + x.text.length, 0);
  let t = start + 0.12;
  return segs.map((seg) => {
    const d = (speech * seg.text.length) / weight;
    const line = { from: t, to: t + d, pause: seg.pause, text: seg.text };
    t += d + seg.pause;
    return line;
  });
}

/** Captions for one voice file, a line at a time; a very short line joins the next ("Six checks. Six passes."). */
function captionsFor(id: VoiceId, start: number, seconds: number, only?: number[]): Cue[] {
  const cues: Cue[] = [];
  for (const [i, line] of linesOf(id, start, seconds).entries()) {
    if (only && !only.includes(i)) continue;
    const to = line.to + Math.min(line.pause, 0.4);
    // each word's turn within the line, by its length: a long word takes longer to say
    const ws = line.text.split(" ");
    const weight = ws.reduce((n, w) => n + w.length + 1, 0);
    let at = line.from;
    const words = ws.map((w) => {
      const d = ((line.to - line.from) * (w.length + 1)) / Math.max(1, weight);
      const word = { text: w, from: at, to: at + d };
      at += d;
      return word;
    });
    const prev = cues.at(-1);
    if (prev && prev.text.length < 16 && prev.text.length + line.text.length < 60 && prev.to >= line.from - 0.8) {
      prev.text = `${prev.text} ${line.text}`;
      prev.to = to;
      prev.words = [...(prev.words ?? []), ...words];
    } else cues.push({ from: line.from, to, text: line.text, words });
  }
  return cues;
}

const Lines = createContext<Partial<Record<VoiceId, number[]>>>({});

/**
 * When line `index` of a voice file starts, in seconds of the scene, so a scene can land a moment on the word that
 * names it. `fallback` when the scene plays on its own.
 */
export function useLine(id: VoiceId, index: number, fallback: number) {
  return useContext(Lines)[id]?.[index] ?? fallback;
}

export async function plan(beats: Beat[], music: string | MusicSync | null): Promise<PlanProps & { durationInFrames: number }> {
  const out: Planned[] = [];
  const cues: Cue[] = [];
  let from = 0;
  for (const beat of beats) {
    const voices = await Promise.all(
      (beat.voice ?? []).map(async (v) => {
        const file = `${v.id}.mp3`;
        const real = await lengthOf(file);
        const seconds = real ?? estimate(v.id);
        const at = "at" in v ? v.at : Math.max(0, v.on - (linesOf(v.id, 0, seconds)[v.line]?.from ?? 0));
        return { id: v.id, at, seconds, real: real !== null, only: v.captions };
      }),
    );
    const needs = Math.max(0, ...voices.map((v) => v.at + v.seconds + 0.7));
    if (beat.fixed && needs > beat.seconds) console.warn(`${beat.id}: its voice runs ${(needs - beat.seconds).toFixed(1)} s past the scene`);
    const length = s(beat.fixed ? beat.seconds : Math.max(beat.seconds, needs));
    if (beat.captions !== false) for (const v of voices) cues.push(...captionsFor(v.id, from / FPS + v.at, v.seconds, v.only));
    const lineStart = (id: VoiceId, line: number) => {
      const v = voices.find((x) => x.id === id);
      if (!v) throw new Error(`${beat.id}: an effect is placed on ${id}, which isn't in this beat`);
      return linesOf(v.id, v.at, v.seconds)[line]?.from ?? v.at;
    };
    const sfx = [];
    for (const e of beat.sfx ?? []) {
      const at = (e.voice ? lineStart(e.voice, e.line ?? 0) : 0) + e.at;
      if ((await lengthOf(e.file)) !== null) sfx.push({ file: e.file, from: from + s(at), volume: e.volume ?? 0.6 });
    }
    const ownWhoosh = (beat.sfx ?? []).some((e) => e.file === "sfx-whoosh.mp3" && e.at < 0.4);
    if (from > 0 && !ownWhoosh && (await lengthOf("sfx-whoosh.mp3")) !== null) sfx.push({ file: "sfx-whoosh.mp3", from: Math.max(0, from - s(0.22)), volume: 0.2 });
    out.push({
      from,
      length,
      voices: voices.map((v) => ({ id: v.id, from: from + s(v.at), seconds: v.seconds, real: v.real, lines: linesOf(v.id, v.at, v.seconds).map((l) => l.from) })),
      sfx,
    });
    from += length;
  }
  const file = typeof music === "string" ? music : (music?.file ?? null);
  const has = file !== null && (await lengthOf(file)) !== null;
  const total = from / FPS;
  return { beats: out, music: has ? file : null, musicCuts: has && music && typeof music !== "string" ? cutMusic(music, beats, out, total) : undefined, cues, durationInFrames: Math.max(1, from) };
}

/** Where each stretch of a synced music file plays: the drop on its beat, then the ending spliced in on its hit. */
function cutMusic(sync: MusicSync, beats: Beat[], planned: Planned[], total: number): MusicCut[] {
  const startOf = (id: string) => {
    const i = beats.findIndex((b) => b.id === id);
    if (i < 0) throw new Error(`music: no beat "${id}"`);
    return planned[i]!.from / FPS;
  };
  // when a line of a beat's voice starts, in seconds of the beat
  const lineIn = (beat: string, voice?: VoiceId, line?: number) => {
    if (!voice || line === undefined) return 0;
    const v = planned[beats.findIndex((x) => x.id === beat)]?.voices.find((x) => x.id === voice);
    if (!v) throw new Error(`music: no voice ${voice} in beat "${beat}"`);
    return v.lines[line]!;
  };
  const gain = sync.gain ?? 1;
  // the file's second at the film's first: its drop lands on the film's (a negative one starts the music late)
  const offset = sync.drop ? sync.drop.track - (startOf(sync.drop.beat) + lineIn(sync.drop.beat, sync.drop.voice, sync.drop.line) + sync.drop.at) : 0;
  // a file entered mid-song fades in over a few frames, so it starts on no click
  const cuts: MusicCut[] = [{ at: Math.max(0, -offset), until: total, from: Math.max(0, offset), fadeIn: offset > 0 ? 0.3 : 0, fadeOut: 2, duck: 1, gain }];
  if (sync.end) {
    const e = sync.end;
    const i = beats.findIndex((b) => b.id === e.beat);
    const voice = e.voice ? planned[i]?.voices.find((v) => v.id === e.voice) : undefined;
    const hit = (voice && e.line !== undefined ? voice.lines[e.line]! : 0) + startOf(e.beat) + e.at;
    const splice = hit - e.lead;
    cuts[0] = { ...cuts[0]!, until: splice + 1, fadeOut: 1 };
    cuts.push({ at: splice, until: total, from: e.track - e.lead, fadeIn: 1, fadeOut: 0, duck: 0.35, gain });
  }
  return cuts;
}

/** A cut the eye feels: the new scene arrives a touch close and settles back, as a camera finding its mark. */
function Punch({ children }: { children: ReactNode }) {
  const f = useCurrentFrame();
  const p = Math.min(1, f / s(0.55));
  const k = 1 + 0.045 * (1 - (1 - (1 - p) ** 3));
  return <AbsoluteFill style={{ transform: `scale(${k})` }}>{children}</AbsoluteFill>;
}

/** And a breath of light across the cut. */
function CutLight() {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 2, s(0.32)], [0, 0.16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return o > 0 ? <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, oklch(0.97 0.03 85), oklch(0.8 0.04 85 / 0.4) 60%, transparent)", opacity: o, pointerEvents: "none" }} /> : null;
}

/** The music sits under the voice: down while anyone speaks, back up in the gaps. */
function ducking(beats: Planned[]) {
  const spans = beats.flatMap((b) => b.voices.filter((v) => v.real).map((v) => [v.from, v.from + s(v.seconds)] as const));
  return (f: number) => {
    const near = spans.reduce((m, [a, b]) => Math.max(m, interpolate(f, [a - 12, a, b, b + 18], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })), 0);
    return 0.62 - 0.4 * near;
  };
}

export function Film({ beats, plan: p, music }: { beats: Beat[]; plan: PlanProps; music?: boolean }) {
  const duck = ducking(p.beats);
  const f = useCurrentFrame();
  const end = p.beats.at(-1);
  const total = end ? end.from + end.length : 1;
  return (
    <AbsoluteFill style={{ background: "black" }}>
      {beats.map((beat, i) => {
        const at = p.beats[i];
        if (!at) return null;
        return (
          <Sequence key={beat.id} from={at.from} durationInFrames={at.length} name={beat.id}>
            <Lines.Provider value={Object.fromEntries(at.voices.map((v) => [v.id, v.lines]))}>
              {i === 0 ? (
                <beat.Scene />
              ) : (
                <Punch>
                  <beat.Scene />
                </Punch>
              )}
            </Lines.Provider>
            {i > 0 ? <CutLight /> : null}
            {at.voices
              .filter((v) => v.real)
              .map((v) => (
                <Sequence key={v.id} from={v.from - at.from} name={v.id}>
                  <Audio src={staticFile(`audio/${v.id}.mp3`)} />
                </Sequence>
              ))}
            {at.sfx
              .filter((e) => e.from >= at.from)
              .map((e) => (
                <Sequence key={`${e.file}-${e.from}`} from={e.from - at.from} name={e.file}>
                  <Audio src={staticFile(`audio/${e.file}`)} volume={e.volume} />
                </Sequence>
              ))}
          </Sequence>
        );
      })}
      {p.beats.flatMap((at) =>
        at.sfx
          .filter((e) => e.from < at.from)
          .map((e) => (
            <Sequence key={`lead-${e.file}-${e.from}`} from={e.from} name={`${e.file} into the cut`}>
              <Audio src={staticFile(`audio/${e.file}`)} volume={e.volume} />
            </Sequence>
          )),
      )}
      {music && p.music
        ? (p.musicCuts ?? [{ at: 0, until: total / FPS, from: 0, fadeIn: 0, fadeOut: 2, duck: 1 }]).map((c) => (
            <Sequence key={`music-${c.at}`} from={s(c.at)} durationInFrames={Math.max(1, s(c.until - c.at))} name={`music from ${c.from.toFixed(1)} s`}>
              <Audio
                src={staticFile(`audio/${p.music}`)}
                trimBefore={Math.round(c.from * FPS)}
                volume={(fr) => {
                  const at = fr + s(c.at);
                  const len = s(c.until - c.at);
                  const fade = Math.min(c.fadeIn ? fr / s(c.fadeIn) : 1, c.fadeOut ? (len - fr) / s(c.fadeOut) : 1, 1);
                  const end = interpolate(at, [total - s(2), total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                  // ducked as far as the cut allows: 0.62 alone, down to 0.22 under a voice
                  const level = 0.62 - (0.62 - duck(at)) * c.duck;
                  return Math.max(0, fade) * end * level * (c.gain ?? 1);
                }}
              />
            </Sequence>
          ))
        : null}
      <Grain opacity={0.045} />
      <Captions cues={p.cues} />
      {/* a one-frame guard: nothing below the captions should flash at the cut to black */}
      {f >= total ? <AbsoluteFill style={{ background: "black" }} /> : null}
    </AbsoluteFill>
  );
}
