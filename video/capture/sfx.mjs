/**
 * Makes an effect land on its frame and at a known level. Generated effects arrive with silence before the hit
 * (the tick's is half a second) and at any level (the rimshot peaks at 1% of full scale, the chime at 5%), so a cue
 * placed on a beat sounds late, or not at all. Each is trimmed to just before its hit and its peak set to −1 dBFS;
 * the film's own volumes then mean what they say. The originals in video/audio/ are left as they are.
 *
 *   node capture/sfx.mjs           (from video/; capture/audio.mjs runs it for every effect it copies)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FFMPEG = join(ROOT, "node_modules", "@remotion", `compositor-${process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const RATE = 44100;

/** Trims `src` to just before its hit and sets its peak to −1 dBFS, writing `dst` (MP3). Returns what it did. */
export function processSfx(src, dst) {
  // decoded to a WAV (this ffmpeg has no raw muxer), its samples read from the data chunk
  const tmp = join(tmpdir(), `unison-sfx-${process.pid}.wav`);
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", tmp]);
  const buf = readFileSync(tmp);
  rmSync(tmp, { force: true });
  let at = 12;
  let pcm = new Int16Array(0);
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") {
      pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + at + 8, buf.byteOffset + at + 8 + (Math.min(size, buf.length - at - 8) & ~1)));
      break;
    }
    at += 8 + size + (size & 1);
  }
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) throw new Error(`${src} is silent`);
  const hit = pcm.findIndex((v) => Math.abs(v) > peak * 0.25);
  // a few milliseconds before the hit, so its attack is kept whole
  const start = Math.max(0, hit / RATE - 0.006);
  const gain = Math.min(60, 0.89 / (peak / 32768));
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", start.toFixed(4), "-i", src, "-af", `volume=${gain.toFixed(3)}`, "-c:a", "libmp3lame", "-b:a", "256k", dst]);
  return { trimmed: start, gain, peak: peak / 32768 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const FROM = join(ROOT, "audio");
  const TO = join(ROOT, "public", "audio");
  for (const f of readdirSync(FROM).filter((x) => /^sfx-.*\.mp3$/.test(x))) {
    if (!existsSync(join(FROM, f))) continue;
    const r = processSfx(join(FROM, f), join(TO, f));
    console.log(`${f}: trimmed ${(r.trimmed * 1000).toFixed(0)} ms of lead, gain ×${r.gain.toFixed(1)} (its peak was ${(r.peak * 100).toFixed(1)}%)`);
  }
}
