export type Master = "display" | "mid" | "small";

/** The optical master for a rendered size: heavy at 20 px and below, the text cut up to 44 px, display above. */
export const masterForSize = (px: number): Master => (px <= 20 ? "small" : px < 44 ? "mid" : "display");
