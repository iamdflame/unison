/**
 * The app's own section glyphs, drawn on a 24-unit grid in the dial's language: hairline strokes with round ends,
 * and one jewel each that fills when its section is open (outline at rest, filled when active). Each says what the
 * section is on Unison, not what a generic finance app would show.
 */
type GlyphProps = { size?: number; strokeWidth?: number; on?: boolean };

function Glyph({ size = 24, strokeWidth = 1.5, children }: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Trade: buyers from above and sellers from below meet at one price, and leave as one line. */
export function TradeGlyph(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M3 4 L10.3 10.6 M3 20 L10.3 13.4 M14.4 12 H21" />
      <circle cx="12" cy="12" r="2.4" fill={p.on ? "currentColor" : "none"} />
    </Glyph>
  );
}

/** Markets: the board, a column of small band dials, each with its line. */
export function MarketsGlyph(p: GlyphProps) {
  return (
    <Glyph {...p}>
      {[5.5, 12, 18.5].map((y, i) => (
        <g key={y}>
          <circle cx="5.5" cy={y} r="2.5" fill={p.on && i === 0 ? "currentColor" : "none"} />
          <path d={`M11 ${y} H21`} />
        </g>
      ))}
    </Glyph>
  );
}

/** Portfolio: what you hold, as the page's allocation bar bent into a ring: three holdings, cut apart. */
export function PortfolioGlyph(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <path d="M14.06 3.75 A8.5 8.5 0 0 1 14.06 20.25 M9.94 20.25 A8.5 8.5 0 0 1 3.83 9.66 M5.89 6.10 A8.5 8.5 0 0 1 9.94 3.75" />
      <circle cx="12" cy="12" r="2.2" fill={p.on ? "currentColor" : "none"} />
    </Glyph>
  );
}

/** Vaults: a safe with its dial, the liquidity that is always there. */
export function VaultsGlyph(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <rect x="3" y="4" width="18" height="16" rx="3.5" />
      <circle cx="12" cy="12" r="4" fill={p.on ? "currentColor" : "none"} />
      <path d="M12 6.8 V5.6 M7 20 V21.5 M17 20 V21.5" />
    </Glyph>
  );
}

/** Agents: a session key, its bow a ring, with the two wards that bound what it can do. */
export function AgentsGlyph(p: GlyphProps) {
  return (
    <Glyph {...p}>
      <circle cx="7" cy="12" r="4.5" fill={p.on ? "currentColor" : "none"} />
      <path d="M11.5 12 H21.5 M17 12 V15.5 M20.5 12 V15" />
    </Glyph>
  );
}
