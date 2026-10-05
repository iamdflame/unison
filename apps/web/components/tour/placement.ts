/**
 * Where the tour's light and its card go, as pure geometry (viewport pixels), so it is tested without a browser.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export type Side = "below" | "above" | "right" | "left" | "center" | "dock-top" | "dock-bottom";

/** the light's margin around what it shows */
export const PAD = 8;
/** the card's distance from the light */
export const GAP = 14;
/** the card's least distance from the viewport's edges */
export const EDGE = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The light around an element's box: padded, and kept inside the viewport (an element taller than the screen is lit
 * where it shows).
 */
export function lightAround(box: Rect, view: Size, pad = PAD): Rect {
  const x0 = clamp(box.x - pad, 4, view.width - 4);
  const y0 = clamp(box.y - pad, 4, view.height - 4);
  const x1 = clamp(box.x + box.width + pad, x0, view.width - 4);
  const y1 = clamp(box.y + box.height + pad, y0, view.height - 4);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The card beside a lit rect, on wide screens: below it if it fits, else above, else to its right, else to its left,
 * else docked at the bottom over it. Always `EDGE` inside the viewport. With nothing lit, centred.
 */
export function placeCard(light: Rect | null, card: Size, view: Size): { x: number; y: number; side: Side } {
  const cx = (view.width - card.width) / 2;
  if (!light) return { x: cx, y: (view.height - card.height) / 2, side: "center" };
  const alongX = clamp(light.x, EDGE, view.width - card.width - EDGE);
  const alongY = clamp(light.y, EDGE, view.height - card.height - EDGE);
  const below = light.y + light.height + GAP;
  if (below + card.height <= view.height - EDGE) return { x: alongX, y: below, side: "below" };
  const above = light.y - GAP - card.height;
  if (above >= EDGE) return { x: alongX, y: above, side: "above" };
  const right = light.x + light.width + GAP;
  if (right + card.width <= view.width - EDGE) return { x: right, y: alongY, side: "right" };
  const left = light.x - GAP - card.width;
  if (left >= EDGE) return { x: left, y: alongY, side: "left" };
  return { x: clamp(cx, EDGE, view.width - card.width - EDGE), y: view.height - card.height - EDGE, side: "dock-bottom" };
}

/**
 * Phones and tablets: the card is a sheet docked at the bottom, or at the top when what is lit sits in the lower half
 * of the screen (the Buy and Sell bar), so it never covers what it explains. `insetBottom` is the safe area.
 */
export function dockCard(light: Rect | null, card: Size, view: Size, insetBottom = 0): { x: number; y: number; side: Side } {
  const x = (view.width - card.width) / 2;
  if (!light) return { x, y: (view.height - card.height) / 2, side: "center" };
  const low = light.y + light.height / 2 > view.height / 2;
  return low ? { x, y: EDGE, side: "dock-top" } : { x, y: view.height - card.height - EDGE - insetBottom, side: "dock-bottom" };
}
