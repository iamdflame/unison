import { AbsoluteFill, Sequence } from "remotion";
import { s } from "../brand";
import { useLine } from "../kit/Plan";
import { Shot } from "../kit/Screen";
import { Challenge } from "./Challenge";

/**
 * "Snipe us." (demo-10): the live /challenge page, its two pots and our sniper's edge on each; then, on "and the board
 * shows every challenger", Envio's table of every challenge account; then the week's replay on "Over a week of real
 * prices", each bar on its words. The page's own scroll is cut, not shown (06-challenge reaches the table by 4.1 s).
 * Every framing keeps the page's sticky header out of the frame.
 */
const TABLE = 4.1;

export const SnipeUs = () => {
  const L = [0.3, 1.7, 6.6, 8.2, 10.0].map((d, i) => useLine("demo-10", i, d));
  // "A standing challenge pays anyone who beats the rule —" is about 2.4 s; the board follows the dash
  const board = L[1]! + 2.4;
  const week = L[2]! - 0.25;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={s(board)} name="the pots">
        <Shot
          take="06-challenge"
          to={3.0}
          pointer={false}
          moves={[
            { at: 0, x: 960, y: 560, zoom: 1.1 },
            // the two pots, side by side, as "a standing challenge pays anyone who beats the rule"
            { at: Math.min(2.4, Math.max(0.3, L[1]! - 0.4)), dur: 1.4, x: 960, y: 640, zoom: 1.42 },
          ]}
        />
      </Sequence>
      <Sequence from={s(board)} durationInFrames={s(week - board)} name="every challenger">
        <Shot
          take="06-challenge"
          from={TABLE}
          pointer={false}
          moves={[
            // "Every challenger", its line on Envio, and the table
            { at: TABLE, x: 960, y: 406, zoom: 1.68 },
            { at: TABLE + 0.1, dur: 3, x: 960, y: 406, zoom: 1.78 },
          ]}
        />
      </Sequence>
      <Sequence from={s(week)} name="the week">
        <Challenge week oldAt={L[3]! - week} unisonAt={L[4]! - week} />
      </Sequence>
    </AbsoluteFill>
  );
};
