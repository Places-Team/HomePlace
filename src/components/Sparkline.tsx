/**
 * A minimal line chart, rendered as SVG on the server.
 *
 * No charting library: a home dashboard draws one series over time, and pulling
 * in a rendering engine for that would cost more in bundle size than everything
 * else on the page put together. It also means charts appear in the first
 * server render instead of after hydration.
 */
export function Sparkline({
  points,
  height = 48,
  min,
  max,
  tone = "accent",
  className = "h-12 w-full",
}: {
  /** [timestamp, value] pairs, oldest first. */
  points: [number, number][];
  height?: number;
  /** Fixed scale bounds. Percentages should pass 0–100 so a flat line at 5%
   *  looks flat, instead of being stretched to fill the box. */
  min?: number;
  max?: number;
  tone?: "accent" | "ok" | "warn" | "danger";
  className?: string;
}) {
  const clean = points.filter(([, v]) => Number.isFinite(v));
  if (clean.length < 2) {
    return <div className={`${className} rounded bg-raised`} aria-hidden />;
  }

  const width = 100; // viewBox units; the SVG scales to its container
  const values = clean.map(([, v]) => v);
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  // A perfectly flat series would divide by zero; give it a band to sit in.
  const span = hi - lo || 1;

  const step = width / (clean.length - 1);
  const coords = clean.map(([, v], i) => {
    const x = i * step;
    const y = height - ((v - lo) / span) * height;
    return [x, Number.isFinite(y) ? y : height] as const;
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const stroke = { accent: "rgb(var(--accent))", ok: "rgb(var(--ok))", warn: "rgb(var(--warn))", danger: "rgb(var(--danger))" }[tone];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-hidden
    >
      <path d={area} fill={stroke} opacity="0.12" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
