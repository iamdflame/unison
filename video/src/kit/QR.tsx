import QRCode from "qrcode";
import { C } from "../brand";

/** A QR code drawn as squares, in the film's ink and champagne: scans to the page it names. */
export const QR = ({ url, size = 320, fg = C.ink, bg = "transparent" }: { url: string; size?: number; fg?: string; bg?: string }) => {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / (n + 4);
  const rects: { x: number; y: number }[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) rects.push({ x, y });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ background: bg, borderRadius: 12 }}>
      {rects.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={(x + 2) * cell} y={(y + 2) * cell} width={cell + 0.4} height={cell + 0.4} fill={fg} />
      ))}
    </svg>
  );
};
