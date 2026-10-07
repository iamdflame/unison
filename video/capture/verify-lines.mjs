/**
 * Writes the film's verification scene (src/scenes/Verify.tsx) from the verifier's real run on the film's trade
 * (src/data/verify-film-trade.txt, from `node apps/web/scripts/verify-receipt.mjs <tx> | tee …`): the command, then
 * each line exactly as it printed, each PASS on its beat.
 *
 *   node capture/verify-lines.mjs        (from video/, after a new capture)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FILM_TX } from "./film-tx.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = readFileSync(join(ROOT, "src", "data", "verify-film-trade.txt"), "utf8").replace(/\r\n/g, "\n").split("\n");
const pick = (re) => {
  const line = run.find((l) => re.test(l));
  if (!line) throw new Error(`the verifier's run has no line matching ${re}`);
  return JSON.stringify(line);
};
const lines = `const CMD = "node apps/web/scripts/verify-receipt.mjs ${FILM_TX}";
export const VERIFY_LINES: TermLine[] = [
  { at: 0.3, kind: "cmd", text: CMD },
  { at: 3.2, kind: "out", text: ${pick(/^auction:/)} },
  { at: 3.5, kind: "dim", text: ${pick(/^\s+price /)} },
  { at: 4.4, kind: "pass", text: ${pick(/^PASS {2}receipt hash/)} },
  { at: 5.0, kind: "dim", text: ${pick(/^\s+Chainlink feed/)} },
  { at: 5.6, kind: "pass", text: ${pick(/^PASS {2}the receipt's reference time/)} },
  { at: 6.6, kind: "pass", text: ${pick(/^PASS {2}observed strictly before/)} },
  { at: 7.6, kind: "pass", text: ${pick(/^PASS {2}the newest order/)} },
  { at: 8.6, kind: "pass", text: ${pick(/^PASS {2}observed \d+ s after the seal/)} },
  { at: 9.6, kind: "pass", text: ${pick(/^PASS {2}the round before/)} },
  { at: 10.6, kind: "hint", text: ${pick(/^every check passed/)} },
];`;
const file = join(ROOT, "src", "scenes", "Verify.tsx");
const src = readFileSync(file, "utf8");
const a = src.indexOf("const CMD =");
const b = src.indexOf("];", a) + 2;
if (a < 0 || b < 2) throw new Error("Verify.tsx has no VERIFY_LINES block");
writeFileSync(file, src.slice(0, a) + lines + src.slice(b));
console.log(`Verify.tsx replays the run on ${FILM_TX.slice(0, 12)}…`);
