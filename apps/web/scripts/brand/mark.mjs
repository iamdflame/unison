/**
 * The chosen mark (v2, after the judge panel) in three optical masters, like a watch dial's printing:
 *   MARK        display, ≥ 44 px: Didone stress, hairline serifs, turned neck and ball
 *   MARK_MID    text, 20–44 px: heavier tines, 2u serifs on a pixel row, gentler stress, larger ball
 *   MARK_SMALL  ≤ 20 px (favicon), snapped to the pixel grid (1 px = 3 units): 3 px tines, 4 px counter, 2 px stem, 4 px ball
 * Every asset, component and icon is generated from these.
 */
export const MARK = {};

export const MARK_MID = {
  stroke: 6,
  gap: 11.5,
  tine: 16,
  serifHeight: 2,
  serifOverhang: 2.2,
  bowlThin: 3.2,
  bowlThinAt: 34,
  bowlCenter: 3.2,
  stemWidth: 4.8,
  stemLength: 5.2,
  yokeFillet: 1.6,
  neck: 1.8,
  neckWaist: 0.84,
  ballRadius: 4.25,
};

export const MARK_SMALL = {
  stroke: 9,
  gap: 12,
  tine: 9,
  serif: false,
  bowlThin: 9,
  bowlCenter: 9,
  stemWidth: 6,
  stemLength: 3,
  yokeFillet: 0,
  neck: 1.7,
  neckWaist: 0.9,
  ballRadius: 6,
  overshoot: 0,
  opticalShift: -1.5, // tine tops on pixel row 1, ball centre on row 12 (16 px)
};
