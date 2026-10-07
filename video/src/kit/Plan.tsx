import { type ComponentType, createContext, useContext } from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { FPS, s } from "../brand";
import script from "../data/script.json";
import { type Cue, Captions } from "./Captions";

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
  /** each file from second `at` of the beat; or placed so that its line `line` lands on second `on` */
  voice?: ({ id: VoiceId; at: number } | { id: VoiceId; line: number; on: number })[];
  /** effects: a file in public/audio and the second of the beat it lands on */
  sfx?: { file: string; at: number; volume?: number }[];
}
export interface Planned {
  /** frames */
  from: number;
  length: number;
  /** each voice file, and when each of its lines starts (seconds of the beat) */
  voices: { id: VoiceId; from: number; seconds: number; real: boolean; lines: number[] }[];
  sfx: { file: string; from: number; volume: number }[];
}
export interface PlanProps {
  beats: Planned[];
  music: string | null;
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

/** Each line of a voice file, from the script: when it starts and ends, its share of the speaking time by length. */
function linesOf(id: VoiceId, start: number, seconds: number) {
  const segs = script[id];
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
function captionsFor(id: VoiceId, start: number, seconds: number): Cue[] {
  const cues: Cue[] = [];
  for (const line of linesOf(id, start, seconds)) {
    const to = line.to + Math.min(line.pause, 0.4);
    const prev = cues.at(-1);
    if (prev && prev.text.length < 16 && prev.text.length + line.text.length < 60 && prev.to >= line.from - 0.8) {
      prev.text = `${prev.text} ${line.text}`;
      prev.to = to;
    } else cues.push({ from: line.from, to, text: line.text });
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

export async function plan(beats: Beat[], music: string | null): Promise<PlanProps & { durationInFrames: number }> {
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
        return { id: v.id, at, seconds, real: real !== null };
      }),
    );
    const needs = Math.max(0, ...voices.map((v) => v.at + v.seconds + 0.7));
    if (beat.fixed && needs > beat.seconds) console.warn(`${beat.id}: its voice runs ${(needs - beat.seconds).toFixed(1)} s past the scene`);
    const length = s(beat.fixed ? beat.seconds : Math.max(beat.seconds, needs));
    for (const v of voices) cues.push(...captionsFor(v.id, from / FPS + v.at, v.seconds));
    const sfx = [];
    for (const e of beat.sfx ?? []) if ((await lengthOf(e.file)) !== null) sfx.push({ file: e.file, from: from + s(e.at), volume: e.volume ?? 0.6 });
    out.push({
      from,
      length,
      voices: voices.map((v) => ({ id: v.id, from: from + s(v.at), seconds: v.seconds, real: v.real, lines: linesOf(v.id, v.at, v.seconds).map((l) => l.from) })),
      sfx,
    });
    from += length;
  }
  return { beats: out, music: music && (await lengthOf(music)) !== null ? music : null, cues, durationInFrames: Math.max(1, from) };
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
              <beat.Scene />
            </Lines.Provider>
            {at.voices
              .filter((v) => v.real)
              .map((v) => (
                <Sequence key={v.id} from={v.from - at.from} name={v.id}>
                  <Audio src={staticFile(`audio/${v.id}.mp3`)} />
                </Sequence>
              ))}
            {at.sfx.map((e) => (
              <Sequence key={`${e.file}-${e.from}`} from={e.from - at.from} name={e.file}>
                <Audio src={staticFile(`audio/${e.file}`)} volume={e.volume} />
              </Sequence>
            ))}
          </Sequence>
        );
      })}
      {music && p.music ? <Audio src={staticFile(`audio/${p.music}`)} volume={(fr) => duck(fr) * interpolate(fr, [total - s(2), total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} /> : null}
      <Captions cues={p.cues} />
      {/* a one-frame guard: nothing below the captions should flash at the cut to black */}
      {f >= total ? <AbsoluteFill style={{ background: "black" }} /> : null}
    </AbsoluteFill>
  );
}
