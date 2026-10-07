/**
 * Aligns the voice to the script. Each file in public/audio that SCRIPT.md has lines for is transcribed on this
 * machine by whisper.cpp (installed into video/whisper.cpp/, never committed), and the script's words are matched to
 * the transcript's, so the film knows when every line really starts and ends. Writes src/data/align.json: Plan.tsx
 * then times the captions and useLine() on those times instead of a guess from each line's length.
 *
 * It also lists where a take departs from the script (a word read differently, a direction read out loud), so that
 * take can be regenerated before it reaches a render.
 *
 *   node capture/align.mjs [id…]        (from video/, after capture/audio.mjs; ids default to every file present)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadWhisperModel, installWhisperCpp, toCaptions, transcribe } from "@remotion/install-whisper-cpp";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WHISPER = join(ROOT, "whisper.cpp");
const VERSION = "1.5.5";
const MODEL = process.env.MODEL ?? "small.en";
const FFMPEG = join(ROOT, "node_modules", "@remotion", `compositor-${process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const script = JSON.parse(readFileSync(join(ROOT, "src", "data", "script.json"), "utf8"));
const OUT = join(ROOT, "src", "data", "align.json");
const aligned = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const asked = process.argv.slice(2);

await installWhisperCpp({ to: WHISPER, version: VERSION, printOutput: false });
await downloadWhisperModel({ model: MODEL, folder: WHISPER, printOutput: false });

// words compared as spoken: lower case, no punctuation, hyphens split, small numbers as words
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const spell = (n) => (n < 20 ? [ONES[n]] : n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]]);
const words = (text) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[—–-]/g, " ")
    .split(/\s+/)
    .flatMap((w) => {
      const bare = w.replace(/[^a-z0-9'.]/g, "").replace(/\.$/, "");
      if (/^\d+$/.test(bare) && Number(bare) < 100) return spell(Number(bare));
      if (/^\d+\.\d+$/.test(bare)) return bare.split(".").flatMap((d, i) => (i ? ["point", ...d.split("").map((x) => ONES[Number(x)])] : spell(Number(d))));
      return bare ? [bare.replace(/'/g, "")] : [];
    });

/** The cheapest edit from the script's words to what was said: each script word's match in the transcript, or none. */
function align(want, got) {
  const n = want.length;
  const m = got.length;
  const cost = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) cost[i][j] = Math.min(cost[i - 1][j - 1] + (want[i - 1] === got[j - 1].word ? 0 : 1), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
  const match = new Array(n).fill(null);
  const diffs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (want[i - 1] === got[j - 1].word ? 0 : 1)) {
      match[i - 1] = j - 1;
      if (want[i - 1] !== got[j - 1].word) diffs.unshift(`"${want[i - 1]}" was read "${got[j - 1].word}"`);
      i--;
      j--;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      diffs.unshift(`"${want[i - 1]}" is missing`);
      i--;
    } else {
      diffs.unshift(`"${got[j - 1].word}" was added`);
      j--;
    }
  }
  return { match, diffs };
}

/** A WAV's 16-bit samples, from its "data" chunk (ffmpeg writes more than the classic 44-byte header). */
function samples(wav) {
  const buf = readFileSync(wav);
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") return new Int16Array(buf.buffer.slice(buf.byteOffset + at + 8, buf.byteOffset + at + 8 + (Math.min(size, buf.length - at - 8) & ~1)));
    at += 8 + size + (size & 1);
  }
  throw new Error(`${wav} has no data chunk`);
}

/**
 * Where each line really starts and stops. whisper.cpp 1.5.5 places words only to the nearest segment, so a line can
 * read most of a second off; the take itself is exact. The script says where it pauses: at every line's end, and
 * inside a line at a dash, an ellipsis, a colon or a comma. Those expected pauses are matched, in order, to the
 * silences actually in the take (a pause may go unheard, a breath may be extra), each costing its distance from where
 * whisper put it; a matched line boundary starts its line where the silence ends.
 */
function refine(wav, lines, spans) {
  const pcm = samples(wav);
  const hop = 160; // 10 ms at 16 kHz
  const rms = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    let sum = 0;
    for (let k = i; k < i + hop; k++) sum += (pcm[k] / 32768) ** 2;
    rms.push(Math.sqrt(sum / hop));
  }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.95)] ?? 0;
  const quiet = Math.max(0.003, loud * 0.06);
  const first = Math.max(0, rms.findIndex((v) => v >= quiet));
  let last = rms.length - 1;
  while (last > first && rms[last] < quiet) last--;
  // the silences between the first sound and the last, 120 ms or longer, as [start, end] in seconds
  const gaps = [];
  let run = -1;
  for (let i = first; i <= last; i++) {
    if (rms[i] < quiet) run = run < 0 ? i : run;
    else {
      if (run >= 0 && i - run >= 12) gaps.push([run / 100, i / 100]);
      run = -1;
    }
  }
  // one silence broken by a click or a breath under 50 ms is one silence
  for (let k = gaps.length - 1; k > 0; k--) if (gaps[k][0] - gaps[k - 1][1] < 0.05) gaps.splice(k - 1, 2, [gaps[k - 1][0], gaps[k][1]]);
  // the pauses the script implies, in order, each with where whisper's words put it
  const want = [];
  lines.forEach((l, li) => {
    const text = l.text;
    const marks = [...text.matchAll(/[—–…:,;](?=\s)/g)].map((m) => m.index);
    for (const at of marks) want.push({ boundary: false, at: spans[li].from + ((spans[li].to - spans[li].from) * at) / Math.max(1, text.length) });
    if (li < lines.length - 1) want.push({ boundary: true, line: li + 1, at: spans[li + 1].from });
  });
  // a monotone match of expected pauses to heard silences, at least cost
  const n = want.length;
  const m = gaps.length;
  const SKIP_HEARD = 0.45;
  const skipWanted = (w) => (w.boundary ? 1.2 : 0.35);
  // a silence more than a second from where whisper heard the pause is not that pause
  const fit = (w, g) => (Math.abs(g[1] - w.at) > 1 ? Infinity : Math.abs(g[1] - w.at));
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      if (i < n) cost[i + 1][j] = Math.min(cost[i + 1][j], cost[i][j] + skipWanted(want[i]));
      if (j < m) cost[i][j + 1] = Math.min(cost[i][j + 1], cost[i][j] + SKIP_HEARD);
      if (i < n && j < m) cost[i + 1][j + 1] = Math.min(cost[i + 1][j + 1], cost[i][j] + fit(want[i], gaps[j]));
    }
  const out = spans.map((sp) => ({ ...sp }));
  const placed = new Set();
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + fit(want[i - 1], gaps[j - 1])) {
      const w = want[i - 1];
      if (w.boundary) {
        out[w.line].from = gaps[j - 1][1];
        out[w.line - 1].to = gaps[j - 1][0];
        placed.add(w.line);
      }
      i--;
      j--;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + skipWanted(want[i - 1])) i--;
    else j--;
  }
  // a line run on with no real pause ("sealed first, then priced") starts after the quietest 60 ms near whisper's time
  for (const w of want) {
    if (!w.boundary || placed.has(w.line)) continue;
    const lo = Math.max(first + 1, Math.round((w.at - 0.6) * 100));
    const hi = Math.min(last - 6, Math.round((w.at + 0.6) * 100));
    let best = -1;
    let bestE = Infinity;
    for (let k = lo; k <= hi; k++) {
      const e = rms[k] + rms[k + 1] + rms[k + 2] + rms[k + 3] + rms[k + 4] + rms[k + 5];
      if (e < bestE) [best, bestE] = [k, e];
    }
    if (best < 0) continue;
    out[w.line].from = (best + 6) / 100;
    out[w.line - 1].to = best / 100;
  }
  out[0].from = first / 100;
  out.at(-1).to = (last + 1) / 100;
  return out.map((sp) => ({ from: Number(sp.from.toFixed(3)), to: Number(Math.max(sp.from + 0.1, sp.to).toFixed(3)) }));
}

let changed = 0;
for (const id of Object.keys(script)) {
  if (asked.length && !asked.includes(id)) continue;
  const mp3 = join(ROOT, "public", "audio", `${id}.mp3`);
  if (!existsSync(mp3)) continue;
  const { size, mtimeMs } = statSync(mp3);
  if (!asked.length && aligned[id]?.size === size && aligned[id]?.mtimeMs === mtimeMs) continue;
  const wav = join(WHISPER, `${id}.wav`);
  execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", mp3, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  const out = await transcribe({ inputPath: wav, whisperPath: WHISPER, whisperCppVersion: VERSION, model: MODEL, modelFolder: WHISPER, tokenLevelTimestamps: true, splitOnWord: true });
  const { captions } = toCaptions({ whisperCppOutput: out });
  // each spoken word with its time; a token that is several words ("13", "5.3") shares its time between them
  const got = captions.flatMap((c) => {
    const ws = words(c.text);
    const step = (c.endMs - c.startMs) / Math.max(1, ws.length);
    return ws.map((word, k) => ({ word, from: (c.startMs + k * step) / 1000, to: (c.startMs + (k + 1) * step) / 1000 }));
  });
  const lines = script[id];
  const want = [];
  const lineOf = [];
  lines.forEach((l, li) => words(l.text).forEach((w) => (want.push(w), lineOf.push(li))));
  const { match, diffs } = align(want, got);
  const spans = lines.map((_, li) => {
    const hits = match.filter((g, wi) => g !== null && lineOf[wi] === li).map((g) => got[g]);
    return hits.length ? { from: Number(hits[0].from.toFixed(3)), to: Number(hits.at(-1).to.toFixed(3)) } : null;
  });
  // a line with no word heard (it shouldn't happen) takes the gap between its neighbours
  spans.forEach((sp, li) => {
    if (sp) return;
    const prev = spans.slice(0, li).reverse().find(Boolean);
    const next = spans.slice(li + 1).find(Boolean);
    spans[li] = { from: prev ? prev.to + 0.2 : 0, to: next ? next.from - 0.2 : (prev?.to ?? 0) + 1 };
  });
  // the take's length, so the film can tell a stale alignment from a fresh one when a file is regenerated
  const seconds = samples(wav).length / 16000;
  const exact = refine(wav, lines, spans);
  aligned[id] = { size, mtimeMs, seconds: Number(seconds.toFixed(3)), lines: exact, heard: captions.map((c) => c.text).join("").trim(), diffs };
  changed++;
  console.log(`${id}: ${exact.map((sp, i) => `${sp.from.toFixed(2)}${Math.abs(sp.from - spans[i].from) > 0.05 ? ` (whisper ${spans[i].from.toFixed(2)})` : ""}`).join("  ")}${diffs.length ? `\n  differs from the script: ${diffs.join("; ")}\n  heard: ${aligned[id].heard}` : ""}`);
}
writeFileSync(OUT, `${JSON.stringify(aligned, null, 2)}\n`);
console.log(`${changed} aligned → src/data/align.json`);
