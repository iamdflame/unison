/**
 * Writes each film's subtitles for its upload (out/<Film>.srt): every line of narration, timed from the take itself
 * (capture/align.mjs) where the film's planner placed it. The films set much of their narration in their own type and
 * carry no captions there; the subtitle file is for anyone watching with the sound off, and for YouTube's search.
 *
 *   node capture/subtitles.mjs Demo Pitch Ad MetaMask Cre Envio      (from video/)
 */
import { bundle } from "@remotion/bundler";
import { selectComposition } from "@remotion/renderer";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ids = process.argv.slice(2);
if (!ids.length) throw new Error("usage: node capture/subtitles.mjs <Composition> [Composition…]");
const script = JSON.parse(readFileSync(join(ROOT, "src", "data", "script.json"), "utf8"));
const align = JSON.parse(readFileSync(join(ROOT, "src", "data", "align.json"), "utf8"));
const serveUrl = await bundle({ entryPoint: join(ROOT, "src", "index.ts"), publicDir: join(ROOT, "public") });

const stamp = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
/** A line as one or two rows of at most `width` characters, broken at a space. */
function rows(text, width = 46) {
  if (text.length <= width) return [text];
  const words = text.split(" ");
  let best = null;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ");
    const b = words.slice(k).join(" ");
    const worst = Math.max(a.length, b.length);
    if (!best || worst < best.worst) best = { a, b, worst };
  }
  return [best.a, best.b];
}
/** A long line split into even cues of two rows each, its time shared by length. */
function cuesOf(text, from, to) {
  const MAX = 92;
  if (text.length <= MAX) return [{ from, to, text: rows(text).join("\n") }];
  const words = text.split(" ");
  const n = Math.ceil(text.length / MAX);
  const parts = [];
  let cur = [];
  for (const w of words) {
    // close a part at the word nearest its even share of the line
    const share = (text.length * (parts.length + 1)) / n;
    const done = parts.reduce((k, p) => k + p.length + 1, 0);
    if (cur.length && parts.length < n - 1 && done + [...cur, w].join(" ").length > share + 4) {
      parts.push(cur.join(" "));
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) parts.push(cur.join(" "));
  const total = parts.reduce((n, p) => n + p.length, 0);
  let at = from;
  return parts.map((p) => {
    const d = ((to - from) * p.length) / total;
    const cue = { from: at, to: at + d, text: rows(p).join("\n") };
    at += d;
    return cue;
  });
}

for (const id of ids) {
  const c = await selectComposition({ serveUrl, id, logLevel: "error" });
  const fps = c.fps;
  const end = c.durationInFrames / fps;
  const cues = [];
  for (const b of c.props.beats) {
    for (const v of b.voices) {
      const start = v.from / fps;
      const lines = script[v.id];
      const real = align[v.id];
      const aligned = real && real.lines.length === lines.length && Math.abs(real.seconds - v.seconds) < 0.15;
      lines.forEach((line, i) => {
        // from the take where it's aligned; otherwise from the planner's line starts, each to the next
        const from = aligned ? start + real.lines[i].from : b.from / fps + v.lines[i];
        const to = aligned ? start + real.lines[i].to : i + 1 < lines.length ? b.from / fps + v.lines[i + 1] - 0.05 : start + v.seconds;
        // held a little past the last word, never into the next line
        cues.push(...cuesOf(line.text, from, Math.min(end, to + Math.min(0.35, line.pause || 0.35))));
      });
    }
  }
  cues.sort((a, b) => a.from - b.from);
  for (let k = 0; k + 1 < cues.length; k++) cues[k].to = Math.min(cues[k].to, cues[k + 1].from - 0.04);
  const srt = cues.map((q, k) => `${k + 1}\n${stamp(q.from)} --> ${stamp(q.to)}\n${q.text}\n`).join("\n");
  writeFileSync(join(ROOT, "out", `${id}.srt`), srt);
  console.log(`${id}: ${cues.length} cues → out/${id}.srt`);
}
