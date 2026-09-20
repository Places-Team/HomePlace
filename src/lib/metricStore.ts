import "server-only";
import { prisma } from "./db";
import { statsForContainers, listContainers } from "./docker";
import { recordContainerHistory } from "./containerHistory";

/**
 * A persisted history of container CPU and memory, for installations without
 * Prometheus.
 *
 * The in-memory history (containerHistory.ts) forgets everything on restart.
 * Its durable counterpart keeps lightweight one-minute samples for a week, so
 * charts survive restarts without Docker's expensive two-reading stats mode.
 */

const MIN_GAP_MS = 60_000;
const KEEP_DAYS = 7;
let lastSample = 0;
let sampling = false;

/** Write one lightweight sample for every running container once a minute. */
export async function sampleContainersToDb(): Promise<void> {
  if (sampling || Date.now() - lastSample < MIN_GAP_MS) return;
  sampling = true;
  // Rate-limit attempts too. A blocked Docker endpoint must not trigger a
  // full retry on every ten-second monitor tick.
  lastSample = Date.now();
  try {
    const running = (await listContainers()).filter((c) => c.state === "running");
    if (running.length === 0) return;
    const stats = await statsForContainers(running, 60, 8);
    if (stats.length === 0) return;
    const at = new Date();
    recordContainerHistory(stats, running.map((container) => container.name), at.getTime());
    await prisma.metricSample.createMany({
      data: stats.map((s) => ({ name: s.name, at, cpu: s.cpu, memory: s.memory })),
    });
  } catch (e) {
    console.error("metric sampling failed:", e);
  } finally {
    sampling = false;
  }
}

/** Drop samples older than the retention window. The monitor calls this hourly. */
export async function pruneMetrics(): Promise<void> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000);
  await prisma.metricSample.deleteMany({ where: { at: { lt: cutoff } } }).catch(() => {});
}

/** Whether any persisted history exists at all — decides if it is worth reading. */
export async function hasDbHistory(): Promise<boolean> {
  return (await prisma.metricSample.findFirst({ select: { id: true } })) !== null;
}

/**
 * Persisted history for every container over the last `minutes`, in one query,
 * as the chart wants it — oldest first, keyed by container name.
 */
export async function containerRangesDb(minutes: number): Promise<Map<string, { cpu: [number, number][]; memory: [number, number][] }>> {
  const since = new Date(Date.now() - minutes * 60_000);
  const rows = await prisma.metricSample.findMany({
    where: { at: { gte: since } },
    orderBy: { at: "asc" },
    select: { name: true, at: true, cpu: true, memory: true },
  });

  const out = new Map<string, { cpu: [number, number][]; memory: [number, number][] }>();
  for (const r of rows) {
    const entry = out.get(r.name) ?? { cpu: [], memory: [] };
    entry.cpu.push([r.at.getTime(), r.cpu]);
    entry.memory.push([r.at.getTime(), r.memory]);
    out.set(r.name, entry);
  }
  return out;
}
