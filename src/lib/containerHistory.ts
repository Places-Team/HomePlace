import "server-only";
import type { ContainerStats } from "./docker";

/**
 * A short history of what each container is costing.
 *
 * Prometheus with cAdvisor answers this properly and for weeks; this is for
 * everyone who has not set that up. The samples live in memory, capped, and are
 * lost on restart — which is the honest trade for a sparkline that appears on a
 * fresh installation with no exporters at all.
 *
 * The durable sampler records once a minute and feeds this in-memory view from
 * the same Docker response, avoiding a second pass over every container.
 */

const MAX_POINTS = 60;
type Point = { at: number; cpu: number; memory: number };

const history = new Map<string, Point[]>();

/** Record the same fallback sample that is persisted by metricStore. */
export function recordContainerHistory(stats: ContainerStats[], runningNames: string[], at = Date.now()): void {
  for (const stat of stats) {
    const points = history.get(stat.name) ?? [];
    points.push({ at, cpu: stat.cpu, memory: stat.memory });
    history.set(stat.name, points.slice(-MAX_POINTS));
  }

  const names = new Set(runningNames);
  for (const name of history.keys()) {
    if (!names.has(name)) history.delete(name);
  }
}

/** Points for one container, oldest first, as the chart wants them. */
export function containerHistory(name: string): { cpu: [number, number][]; memory: [number, number][] } {
  const points = history.get(name) ?? [];
  return {
    cpu: points.map((p) => [p.at, p.cpu]),
    memory: points.map((p) => [p.at, p.memory]),
  };
}

export function hasHistory(): boolean {
  return history.size > 0;
}
