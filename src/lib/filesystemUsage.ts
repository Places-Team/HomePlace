export type FilesystemSample = {
  metric: Record<string, string>;
  value: number;
};

export type FilesystemUsage = {
  mount: string;
  device: string;
  instance: string;
  total: number;
  free: number | null;
  used: number | null;
  usedPercent: number | null;
};

function key(metric: Record<string, string>, includeDevice: boolean): string {
  return [metric.instance ?? "", metric.mountpoint ?? "", includeDevice ? metric.device ?? "" : ""].join("|");
}

/**
 * Join node-exporter filesystem gauges without inventing zero free space.
 *
 * Some exporters omit `device` on one of the gauges, so the mount-only key is
 * a deliberate fallback. Missing availability stays unknown instead of making
 * a healthy multi-terabyte disk look 100% full.
 */
export function filesystemUsage(sizes: FilesystemSample[], available: FilesystemSample[]): FilesystemUsage[] {
  const exact = new Map(available.map((sample) => [key(sample.metric, true), sample.value]));
  const byMount = new Map(available.map((sample) => [key(sample.metric, false), sample.value]));

  return sizes
    .map((sample) => {
      const total = Number.isFinite(sample.value) ? sample.value : 0;
      const matched = exact.get(key(sample.metric, true)) ?? byMount.get(key(sample.metric, false));
      const free = matched !== undefined && Number.isFinite(matched) ? Math.max(0, Math.min(total, matched)) : null;
      const used = free === null ? null : Math.max(0, total - free);

      return {
        mount: sample.metric.mountpoint ?? "?",
        device: sample.metric.device ?? "",
        instance: sample.metric.instance ?? "",
        total,
        free,
        used,
        usedPercent: used === null || total <= 0 ? null : (used / total) * 100,
      };
    })
    .filter((row) => row.total > 0);
}
