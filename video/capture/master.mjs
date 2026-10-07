/**
 * Masters a rendered film's sound for upload: one steady gain to -15 LUFS integrated (YouTube plays at -14 and never
 * turns a quiet video up), then a look-ahead peak limiter at -2.5 dBFS so the gain never clips, even after the AAC encode. A steady gain keeps
 * the film's dynamics (the held breath before the drop stays a held breath); only the few peaks above the ceiling are
 * caught, over a few milliseconds. The picture is copied as it was rendered.
 *
 *   node capture/master.mjs Demo Pitch Ad      (from video/, after rendering out/<Film>.mp4; writes out/<Film>-master.mp4)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FFMPEG = join(ROOT, "node_modules", "@remotion", `compositor-${process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const TARGET = -15; // LUFS
const CEILING = 10 ** (-2.5 / 20); // sample peak, a margin under -1 dBTP for the peaks between samples and the AAC encode
const RATE = 48000;

/** ffmpeg's EBU R128 measurement of a file: integrated loudness (LUFS) and true peak (dBTP), from its stderr. */
function measure(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file, "-vn", "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const out = r.stderr ?? "";
  const json = JSON.parse(out.slice(out.lastIndexOf("{"), out.lastIndexOf("}") + 1));
  return { i: Number(json.input_i), tp: Number(json.input_tp), lra: Number(json.input_lra) };
}

/** The stereo samples of a file's sound, as floats (ffmpeg decodes to a WAV; its data chunk is read). */
function decode(file, tmp) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vn", "-ac", "2", "-ar", String(RATE), "-c:a", "pcm_s16le", tmp]);
  const buf = readFileSync(tmp);
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") {
      const n = Math.min(size, buf.length - at - 8) >> 1;
      const out = new Float32Array(n);
      for (let k = 0; k < n; k++) out[k] = buf.readInt16LE(at + 8 + 2 * k) / 32768;
      return out;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error(`${file}: no sound`);
}

function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let k = 0; k < samples.length; k++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[k] * 32767))), 2 * k);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8, "ascii");
  head.write("fmt ", 12, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([head, data]));
}

/**
 * Gain, then a peak limiter: the gain each frame needs to stay under the ceiling, its minimum over the next 5 ms (so
 * the gain is already down when a peak arrives), recovering over 80 ms.
 */
function limit(x, gain) {
  const frames = x.length / 2;
  const look = Math.round(0.005 * RATE);
  const need = new Float32Array(frames);
  for (let n = 0; n < frames; n++) {
    const a = Math.max(Math.abs(x[2 * n]), Math.abs(x[2 * n + 1])) * gain;
    need[n] = a > CEILING ? CEILING / a : 1;
  }
  // a running minimum over [n, n + look] (a monotone deque)
  const ahead = new Float32Array(frames);
  const q = new Int32Array(frames);
  let h = 0;
  let tl = 0;
  for (let n = frames - 1; n >= 0; n--) {
    while (tl > h && need[q[tl - 1]] >= need[n]) tl--;
    q[tl++] = n;
    while (q[h] > n + look) h++;
    ahead[n] = need[q[h]];
  }
  const release = 1 - Math.exp(-1 / (0.08 * RATE));
  const y = new Float32Array(x.length);
  let g = 1;
  let caught = 0;
  for (let n = 0; n < frames; n++) {
    g = ahead[n] < g ? ahead[n] : g + (1 - g) * release;
    if (g < 0.999) caught++;
    y[2 * n] = x[2 * n] * gain * g;
    y[2 * n + 1] = x[2 * n + 1] * gain * g;
  }
  return { y, caught: caught / frames };
}

for (const film of process.argv.slice(2)) {
  const src = join(ROOT, "out", `${film}.mp4`);
  const dst = join(ROOT, "out", `${film}-master.mp4`);
  const tmp = join(ROOT, "out", `${film}-sound.wav`);
  const tmpOut = join(ROOT, "out", `${film}-sound-master.wav`);
  const before = measure(src);
  const gain = 10 ** ((TARGET - before.i) / 20);
  const { y, caught } = limit(decode(src, tmp), gain);
  writeWav(tmpOut, y);
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-i", tmpOut, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", dst]);
  rmSync(tmp, { force: true });
  rmSync(tmpOut, { force: true });
  const after = measure(dst);
  console.log(`${film}: ${before.i.toFixed(1)} LUFS (peak ${before.tp.toFixed(1)} dBTP) → ${after.i.toFixed(1)} LUFS (peak ${after.tp.toFixed(1)} dBTP), gain +${(TARGET - before.i).toFixed(1)} dB, the limiter working ${(caught * 100).toFixed(1)}% of the time → out/${film}-master.mp4`);
}
