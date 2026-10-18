/**
 * The sound of SealFilm, made with ElevenLabs: the narrator's seven lines (the films' voice, Brian), seven effects and
 * a 26 s score. Each line is placed on the beat where its words arrive on screen. Writes the files into public/audio
 * (effects trimmed to their hit and set to −1 dBFS by capture/sfx.mjs) and src/data/seal-audio.json, which the film
 * reads: anything not made yet falls back to the house library, so the film always renders.
 *
 *   node scripts/seal-audio.mjs [voice|sfx|music …]     (from video/; the key is read from ../.env.local by name)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { processSfx } from "../capture/sfx.mjs";
import { eleven } from "./eleven.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW = join(ROOT, "audio");
const PUB = join(ROOT, "public", "audio");
const MANIFEST = join(ROOT, "src", "data", "seal-audio.json");
mkdirSync(RAW, { recursive: true });
mkdirSync(PUB, { recursive: true });

/** Each line on the second its words arrive on screen (SealFilm's beats). */
export const LINES = [
  { id: "seal-01", at: 0.1, text: "We built a bot to snipe our own exchange." },
  { id: "seal-02", at: 4.15, text: "On the old rule, it won." },
  { id: "seal-03", at: 6.25, text: "The contract paid it." },
  { id: "seal-04", at: 9.15, text: "On Unison, it kept trying." },
  { id: "seal-05", at: 14.4, text: "The seal held." },
  { id: "seal-06", at: 15.85, text: "You can't front-run a price that doesn't exist yet." },
  { id: "seal-07", at: 22.45, text: "Snipe us." },
];

export const EFFECTS = {
  lock: { s: 0.8, text: "Crisp mechanical click of a rifle scope locking onto a target, a single click, close microphone, dry, no echo" },
  crack: { s: 1.2, text: "A sealing-wax seal cracking and snapping in two, a sharp brittle crack, close-up foley, dry" },
  chips: { s: 1.2, text: "Tiny hard fragments of wax scattering and bouncing on a paper desk, close foley" },
  stamp: { s: 0.8, text: "A heavy rubber stamp slammed down onto paper on a wooden desk, one solid thud, close foley" },
  strike: { s: 0.5, text: "A short muffled impact, a soft dull thud, a single hit" },
  ticking: { s: 6, text: "A luxury mechanical watch ticking, close microphone, steady, a quiet room" },
  fork: { s: 3.5, text: "A tuning fork struck once, a pure resonant tone with a long shimmering decay" },
};

const MUSIC = {
  ms: 26000,
  prompt:
    "Minimal, luxurious cinematic underscore for a 26-second Swiss-watch style film. Soft ticking clockwork percussion over a low warm pulse; tension builds; a light rising pulse from 9 to 15 seconds; near silence at 15.5 seconds; a warm low piano and celesta motif; resolves gently at 25 seconds. Instrumental, no vocals.",
};

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { voice: [], sfx: {}, music: null };
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
const want = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ["voice", "sfx", "music"]);

if (want.has("voice")) {
  const voices = await eleven("/v2/voices?search=Brian&page_size=20");
  const voice = (voices.voices ?? []).find((v) => v.name.toLowerCase().startsWith("brian")) ?? { voice_id: "nPczCjzI2devNBz1zQrb", name: "Brian" };
  const models = await eleven("/v1/models");
  const tts = models.filter((m) => m.can_do_text_to_speech !== false).map((m) => m.model_id);
  const model = tts.find((id) => /v4/.test(id) && !/turbo|flash/.test(id)) ?? tts.find((id) => /v3/.test(id)) ?? "eleven_multilingual_v2";
  console.log(`voice ${voice.name} (${voice.voice_id}), model ${model}`);
  manifest.voice = [];
  for (const line of LINES) {
    const r = await eleven(`/v1/text-to-speech/${voice.voice_id}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      body: { text: line.text, model_id: model, voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0, use_speaker_boost: true } },
    });
    const audio = Buffer.from(r.audio_base64, "base64");
    writeFileSync(join(RAW, `${line.id}.mp3`), audio);
    writeFileSync(join(PUB, `${line.id}.mp3`), audio);
    // words and their times, from the characters' alignment
    const a = r.alignment ?? r.normalized_alignment;
    const words = [];
    let cur = null;
    a.characters.forEach((ch, i) => {
      if (/\s/.test(ch)) {
        if (cur) words.push(cur);
        cur = null;
      } else {
        if (!cur) cur = { text: "", from: a.character_start_times_seconds[i], to: 0 };
        cur.text += ch;
        cur.to = a.character_end_times_seconds[i];
      }
    });
    if (cur) words.push(cur);
    const dur = a.character_end_times_seconds.at(-1);
    manifest.voice.push({ ...line, file: `${line.id}.mp3`, seconds: dur, words });
    console.log(`${line.id}: ${dur.toFixed(2)} s  "${line.text}"`);
    save();
  }
}

if (want.has("sfx")) {
  for (const [name, fx] of Object.entries(EFFECTS)) {
    const raw = join(RAW, `sfx-seal-${name}.mp3`);
    const bytes = await eleven("/v1/sound-generation?output_format=mp3_44100_128", { method: "POST", body: { text: fx.text, duration_seconds: fx.s, prompt_influence: 0.55 }, raw: true });
    writeFileSync(raw, bytes);
    // the ticking bed keeps its own start; every hit is trimmed to land on its frame
    if (name === "ticking") writeFileSync(join(PUB, `sfx-seal-${name}.mp3`), bytes);
    else processSfx(raw, join(PUB, `sfx-seal-${name}.mp3`));
    manifest.sfx[name] = `sfx-seal-${name}.mp3`;
    console.log(`sfx ${name}`);
    save();
  }
}

if (want.has("music")) {
  let bytes = null;
  for (const path of ["/v1/music?output_format=mp3_44100_128", "/v1/music/compose?output_format=mp3_44100_128"]) {
    try {
      bytes = await eleven(path, { method: "POST", body: { prompt: MUSIC.prompt, music_length_ms: MUSIC.ms, force_instrumental: true }, raw: true });
      break;
    } catch (e) {
      console.log(`music via ${path.split("?")[0]}: ${e.message.slice(0, 160)}`);
    }
  }
  if (bytes) {
    writeFileSync(join(RAW, "music-seal.mp3"), bytes);
    writeFileSync(join(PUB, "music-seal.mp3"), bytes);
    manifest.music = "music-seal.mp3";
    console.log("music: music-seal.mp3");
  } else console.log("music: none made; the film keeps the house track");
  save();
}
