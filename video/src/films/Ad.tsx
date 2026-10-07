import { AbsoluteFill, Sequence } from "remotion";
import { s } from "../brand";
import { type Beat, Film, plan, type PlanProps, useLine } from "../kit/Plan";
import { Close } from "../scenes/Close";
import { PhotoFinish } from "../scenes/PhotoFinish";

/**
 * The ad (≤ 0:30), SCRIPT.md §4: the photo finish, raced in silence under the music, then the voice. "One paid the
 * sniper." lands on the freeze frame, and "Unison." on the end card.
 */
function AdScene() {
  const card = useLine("ad-01", 4, 13.9) - 0.3;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={s(card)} name="photo finish">
        <PhotoFinish />
      </Sequence>
      <Sequence from={s(card)} name="close">
        <Close />
      </Sequence>
    </AbsoluteFill>
  );
}

export const AD: Beat[] = [
  {
    id: "ad",
    Scene: AdScene,
    seconds: 21,
    voice: [{ id: "ad-01", line: 2, on: 9.9 }],
    sfx: [{ file: "sfx-shutter.mp3", at: 9.98, volume: 0.7 }],
  },
];

export const planAd = () => plan(AD, "music-demo.mp3");

export const Ad = (props: PlanProps) => <Film beats={AD} plan={props} music />;
