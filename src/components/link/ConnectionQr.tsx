import { BarcodeFormat, EncodeHintType, QRCodeWriter } from "@zxing/library";

export function ConnectionQr({ value, label }: { value: string; label: string }) {
  const hints = new Map<EncodeHintType, number>([[EncodeHintType.MARGIN, 2]]);
  const matrix = new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 0, 0, hints);
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const commands: string[] = [];

  for (let y = 0; y < height; y += 1) {
    let start = -1;
    for (let x = 0; x <= width; x += 1) {
      const dark = x < width && matrix.get(x, y);
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        commands.push(`M${start} ${y}h${x - start}v1H${start}z`);
        start = -1;
      }
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      className="h-44 w-44 rounded-control bg-white p-2"
      shapeRendering="crispEdges"
    >
      <title>{label}</title>
      <rect width={width} height={height} fill="white" />
      <path d={commands.join("")} fill="black" />
    </svg>
  );
}
