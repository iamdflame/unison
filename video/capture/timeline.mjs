/**
 * Prints a film's timeline as it will render, from the films' own planner with your real audio: each beat's start
 * and length, each voice file's span and its lines, and anything that needs a look (a voice running past a fixed
 * beat, two voices over each other, a voice still estimated because its file isn't in public/audio yet).
 *
 *   node capture/timeline.mjs Demo [Pitch …]     (from video/)
 */
import { bundle } from "@remotion/bundler";
import { selectComposition } from "@remotion/renderer";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ids = process.argv.slice(2);
if (!ids.length) throw new Error("usage: node capture/timeline.mjs <Composition> [Composition…]");
const serveUrl = await bundle({ entryPoint: join(ROOT, "src", "index.ts"), publicDir: join(ROOT, "public") });
const mmss = (sec) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, "0")}`;
for (const id of ids) {
  const c = await selectComposition({ serveUrl, id, logLevel: "error" });
  const fps = c.fps;
  const { beats, music } = c.props;
  console.log(`\n${id}: ${mmss(c.durationInFrames / fps)} at ${fps} fps, music ${music ?? "none"}`);
  const spans = [];
  for (const [i, b] of beats.entries()) {
    console.log(`  beat ${i + 1} at ${mmss(b.from / fps)}, ${(b.length / fps).toFixed(2)} s`);
    for (const v of b.voices) {
      const from = v.from / fps;
      const to = from + v.seconds;
      spans.push({ id: v.id, from, to });
      console.log(`    ${v.id}${v.real ? "" : " (estimated: not in public/audio)"} ${mmss(from)}–${mmss(to)}; lines at ${v.lines.map((l) => l.toFixed(2)).join(", ")} s of the beat`);
      if (to > (b.from + b.length) / fps + 0.01) console.log(`    ! ${v.id} runs ${(to - (b.from + b.length) / fps).toFixed(2)} s past its beat`);
    }
  }
  for (const m of c.props.musicCuts ?? []) console.log(`  music ${mmss(m.at)}–${mmss(m.until)} plays the file from ${mmss(m.from)} (fade in ${m.fadeIn} s, out ${m.fadeOut} s)`);
  spans.sort((a, b) => a.from - b.from);
  for (let k = 1; k < spans.length; k++) if (spans[k].from < spans[k - 1].to - 0.05) console.log(`  ! ${spans[k].id} starts ${(spans[k - 1].to - spans[k].from).toFixed(2)} s before ${spans[k - 1].id} ends`);
}
