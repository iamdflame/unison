import { AbsoluteFill, Sequence } from "remotion";
import { s } from "../brand";
import { useLine } from "../kit/Plan";
import { Shot } from "../kit/Screen";
import { Challenge } from "./Challenge";

/**
 * "Snipe us." (demo-09): the live /challenge page, its two pots and our sniper's edge on each, then the week's
 * replay on "Over a week of real prices", each bar on its words.
 */
export const SnipeUs = () => {
  const L = [0.3, 1.7, 5.0, 6.6, 8.4].map((d, i) => useLine("demo-09", i, d));
  const cut = L[2]! - 0.25;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={s(cut)} name="the page">
        <Shot
          take="06-challenge"
          to={3.0}
          pointer={false}
          moves={[
            { at: 0, x: 960, y: 520, zoom: 1.1 },
            // the two pots, side by side, as "a standing challenge pays anyone who beats the rule"
            { at: Math.min(2.4, Math.max(0.3, L[1]! - 0.4)), dur: 1.4, x: 960, y: 640, zoom: 1.42 },
          ]}
        />
      </Sequence>
      <Sequence from={s(cut)} name="the week">
        <Challenge week oldAt={L[3]! - cut} unisonAt={L[4]! - cut} />
      </Sequence>
    </AbsoluteFill>
  );
};
