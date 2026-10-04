# The Unison mark

**A tuning fork is a U with a stem.** An orchestra reaches unison by tuning to one reference pitch. Unison clears every order against one reference price. The two tines are the buyers and the sellers. The ball at the end of the stem is the fork's resonator, and it is also the single price point everyone gets.

The mark is drawn like a Didone letter, so it belongs to the Bodoni wordmark, and finished like a turned watch part.

## Geometry (mark v2)

The mark sits on a 48-unit grid. The single source is `scripts/brand/emblem.mjs` plus `scripts/brand/mark.mjs`; every asset and component is generated from them by `pnpm brand`.

| Part | Display master (≥ 44 px) |
|---|---|
| Tines | 5.5 wide, counter 12.5, hairline serifs 1.3 × 2.4 overhang |
| Bowl | True semicircle outside. Inside, Didone stress: full stroke at the sides, thinning to 2.2 from ±34° to the bottom, so the hairline shows on both sides of the stem |
| Stem | 3.9 wide, bracketed into the bowl with 1.5 concave fillets |
| Neck and ball | The neck waists to 80% and meets the sphere tangentially (turned, not stamped). Ball radius 3.6 (Ø 1.85 × the stem) |

There are three optical masters, the way a watch dial's printing changes with size:
- **Display, ≥ 44 px.**
- **Text, 20–44 px.** 6u tines, 2u serifs on a pixel row, 3.2u bowl, 4.8 stem, 4.25 ball.
- **Heavy, ≤ 20 px.** Snapped to the 16 px grid: tines at x 3–6 and 10–13, stem 7–9, ball 6–10, tine tops on row 1.

## Finish

- **Monochrome** (engraving, print, single colour): ink or porcelain only.
- **Screen.** The ball is a material, never flat UI colour:
  - by day, heat-blued steel (`#24318F` family, lit from the upper left);
  - by night, lume that glows inside its edge (halo no wider than 1.5× the ball).
- **App icon:**
  - an onyx dial with one centre: the ball is the arbor;
  - a fumé sunray of 200 rays (200 beats make a minute) at 100 px and above;
  - a snailed sub-dial edged with one champagne hairline, so the stem reads as a small-seconds hand at 12;
  - a rhodium figure.
- **Maskable / Apple icons:** opaque and full-bleed, with the art inside the safe zone.

## Motion

The mark behaves like an escapement, not a logo.
- Nothing moves between beats.
- On a fill, the tines flex in antiphase by at most 1 px at the rendered size and settle within three beats (800 ms, damped oscillator).
- The ball, the reference, never moves.
- Lume charges with traded volume; it never pulses.
- Reduced motion: no flex at all.

## Usage

- **Minimum size:** 16 px, Heavy master.
- **Clear space:** one counter width on every side.
- **Lockup:** mark and wordmark share one baseline. The serifs sit on the cap line, the bowl on the baseline, and the stem and ball hang as a descender. The gap is 0.62–0.8 em by master.
- **Never:** stretch it, outline it, rotate it, add effects, recolour the body, or set it on busy imagery.
- **Language:** call it "the mark" or "the tuning fork". Never just "the fork", because in crypto a "hard fork" is a chain split, the opposite of unison.

## How it was chosen

1. **Round 1:** 16 parametric candidates (monoline, Didone serifs, ball, jewel, taper, foot). The Didone family won; tapers read as a nib or pitchfork, round tips as cartoonish.
2. **Round 2:** 12 refinements (stress, foot, ball, proportions). The ball emerged as both resonator and price point.
3. **Round 3:** 11 candidates plus favicon masters, then four finalists shown in real use (nav, lockup, tab, app icons).
4. **Judge panel (fresh context):**
   - a brand designer picked F3, the jewel ball;
   - a former Apple HI designer picked F1's geometry with F3's colour at ≥ 48 px, plus pixel fixes;
   - a haute-horlogerie creative director picked F2, with colour only as material, and asked for the escapement motion.

   All three named the same weakness: the bottom third read as a pin or thermometer.
5. **v2:** the bracketed yoke, turned neck, finished ball, flat-thin bowl, three masters and pixel snapping resolved it.

Exploration boards: `brand/explore/round-1.png` to `round-3.png`, `finalists.png`, `board-v2.png`.

**Clearances pending (owner action):** "Unison" is also a UK trade union (UNISON) and a US home-equity company. Run a trademark search before registering the name and mark.
