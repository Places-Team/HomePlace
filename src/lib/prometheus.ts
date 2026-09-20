import "server-only";
import { prometheusConfig } from "./integrations";

/**
 * Prometheus is the source of every number with a history: CPU, memory, disk
 * usage, temperatures, per-container metrics.
 *
 * HomePlace does not scrape anything itself. Storing time series in SQLite next
 * to a dashboard is a worse version of a tool most home labs already run, and
 * without it the panel still works — it just shows fewer numbers.
 */

export type Sample = { metric: Record<string, string>; value: number; time: number };
export type Series = { metric: Record<string, string>; points: [number, number][] };

function auth(cfg: { username?: string; password?: string }): HeadersInit {
  if (!cfg.username || !cfg.password) return {};
  const token = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  return { authorization: `Basic ${token}` };
}

async function promFetch(path: string, params: Record<string, string>) {
  const cfg = await prometheusConfig();
  if (!cfg) throw new Error("prometheus is not configured");
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${cfg.url}${path}?${qs}`, {
    headers: auth(cfg),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`prometheus HTTP ${res.status}`);
  const body = await res.json();
  if (body.status !== "success") throw new Error(body.error ?? "prometheus returned an error");
  return body.data;
}

/** Instant query. Returns [] rather than throwing when Prometheus is absent. */
export async function query(promql: string): Promise<Sample[]> {
  if (!(await prometheusConfig())) return [];
  try {
    const data = await promFetch("/api/v1/query", { query: promql });
    if (data.resultType !== "vector") return [];
    return data.result.map((r: { metric: Record<string, string>; value: [number, string] }) => ({
      metric: r.metric,
      time: r.value[0] * 1000,
      value: Number(r.value[1]),
    }));
  } catch (e) {
    console.error("prometheus query failed:", promql, e);
    return [];
  }
}

/** Single number, for a gauge tile. */
export async function queryOne(promql: string): Promise<number | null> {
  const rows = await query(promql);
  if (rows.length === 0) return null;
  const v = rows[0].value;
  return Number.isFinite(v) ? v : null;
}

/** Range query, for charts. `minutes` back from now. */
export async function queryRange(promql: string, minutes: number, points = 120): Promise<Series[]> {
  if (!(await prometheusConfig())) return [];
  const end = Math.floor(Date.now() / 1000);
  const start = end - minutes * 60;
  // Keep the number of points near what the chart can actually draw; a 30-day
  // range at 15s resolution is 170k points nobody will ever see.
  const step = Math.max(15, Math.round((end - start) / points));
  try {
    const data = await promFetch("/api/v1/query_range", {
      query: promql,
      start: String(start),
      end: String(end),
      step: String(step),
    });
    return data.result.map((r: { metric: Record<string, string>; values: [number, string][] }) => ({
      metric: r.metric,
      points: r.values.map(([t, v]) => [t * 1000, Number(v)] as [number, number]),
    }));
  } catch (e) {
    console.error("prometheus range query failed:", promql, e);
    return [];
  }
}

/**
 * Ready-made queries for the built-in widgets.
 *
 * They assume node_exporter and cAdvisor, the two exporters practically every
 * home lab already has. `instance` narrows them to one machine; empty means all.
 */
export const Q = {
  cpuPercent: (instance?: string) =>
    `100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"${sel(instance)}}[2m])) * 100)`,
  memoryPercent: (instance?: string) =>
    `100 * (1 - node_memory_MemAvailable_bytes${sel(instance, true)} / node_memory_MemTotal_bytes${sel(instance, true)})`,
  memoryUsedBytes: (instance?: string) =>
    `node_memory_MemTotal_bytes${sel(instance, true)} - node_memory_MemAvailable_bytes${sel(instance, true)}`,
  memoryTotalBytes: (instance?: string) => `node_memory_MemTotal_bytes${sel(instance, true)}`,
  // Swap: reported as a percentage of what swap exists, so a machine with no
  // swap simply has no series and the card hides itself.
  swapPercent: (instance?: string) =>
    `100 * (1 - node_memory_SwapFree_bytes${sel(instance, true)} / (node_memory_SwapTotal_bytes${sel(instance, true)} > 0))`,
  swapUsedBytes: (instance?: string) =>
    `node_memory_SwapTotal_bytes${sel(instance, true)} - node_memory_SwapFree_bytes${sel(instance, true)}`,
  swapTotalBytes: (instance?: string) => `node_memory_SwapTotal_bytes${sel(instance, true)}`,
  load1: (instance?: string) => `node_load1${sel(instance, true)}`,
  load5: (instance?: string) => `node_load5${sel(instance, true)}`,
  load15: (instance?: string) => `node_load15${sel(instance, true)}`,
  /** Logical CPU count, so a load average can be shown against the cores it has. */
  cpuCount: (instance?: string) => `count by (instance) (node_cpu_seconds_total{mode="idle"${sel(instance)}})`,
  /** Disk throughput across the real block devices, loop and ram excluded. */
  diskReadBytes: (instance?: string) =>
    `sum(rate(node_disk_read_bytes_total{device!~"loop.*|ram.*|dm-.*"${sel(instance)}}[2m]))`,
  diskWriteBytes: (instance?: string) =>
    `sum(rate(node_disk_written_bytes_total{device!~"loop.*|ram.*|dm-.*"${sel(instance)}}[2m]))`,
  uptimeSeconds: (instance?: string) => `time() - node_boot_time_seconds${sel(instance, true)}`,
  /** Filesystem usage, one series per mount point. tmpfs and overlays excluded. */
  filesystems: (instance?: string) =>
    `node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"${sel(instance)}}`,
  filesystemsFree: (instance?: string) =>
    `node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"${sel(instance)}} or node_filesystem_free_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"${sel(instance)}}`,
  temperatures: (instance?: string) => `node_hwmon_temp_celsius${sel(instance, true)}`,
  networkRx: (instance?: string) => `rate(node_network_receive_bytes_total{device!~"lo|veth.*|br-.*|docker.*"${sel(instance)}}[2m])`,
  networkTx: (instance?: string) => `rate(node_network_transmit_bytes_total{device!~"lo|veth.*|br-.*|docker.*"${sel(instance)}}[2m])`,
  /** Machines reporting to Prometheus — the list behind the host switcher. */
  instances: () => `up{job=~".*node.*"}`,
  containerCpu: (name: string) => `rate(container_cpu_usage_seconds_total{name="${escape(name)}"}[2m]) * 100`,
  containerMemory: (name: string) => `container_memory_working_set_bytes{name="${escape(name)}"}`,
  /**
   * CPU and memory for every container at once, for the load widget.
   *
   * `name!=""` drops cAdvisor's own aggregate series for cgroup slices, which
   * otherwise appear as unnamed rows using more CPU than anything real.
   */
  allContainerCpu: () => `sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[2m])) * 100`,
  allContainerMemory: () => `sum by (name) (container_memory_working_set_bytes{name!=""})`,
};

/** Build a label selector fragment, either appended to existing labels or alone. */
function sel(instance?: string, standalone = false): string {
  if (!instance) return "";
  const matcher = `instance="${escape(instance)}"`;
  return standalone ? `{${matcher}}` : `,${matcher}`;
}

/** PromQL string literals are double-quoted; a stray quote would break the query. */
function escape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * What this Prometheus actually has.
 *
 * Writing PromQL from memory is a skill; picking from a list is not. These two
 * feed the widget dialog, so a chart can be built by choosing a metric and a
 * machine rather than by recalling the exact spelling of
 * `node_memory_MemAvailable_bytes`.
 */
export async function metricNames(prefix = ""): Promise<string[]> {
  if (!(await prometheusConfig())) return [];
  try {
    const data = await promFetch("/api/v1/label/__name__/values", {});
    const all = Array.isArray(data) ? (data as string[]) : [];
    const filtered = prefix ? all.filter((name) => name.includes(prefix)) : all;
    return filtered.sort().slice(0, 500);
  } catch {
    return [];
  }
}

/** Machines reporting to this Prometheus, for the instance picker. */
export async function instanceNames(): Promise<string[]> {
  const rows = await query("up");
  return [...new Set(rows.map((r) => r.metric.instance).filter(Boolean))].sort();
}

/**
 * Ready-made questions, in the words someone would use to ask them.
 *
 * The list is what a home server is actually asked, and each entry carries the
 * query, the unit and sensible gauge bounds — so choosing "disk usage" produces
 * a working tile with no further decisions.
 */
export const METRIC_PRESETS: {
  key: string;
  query: (instance?: string) => string;
  unit: "percent" | "bytes" | "number";
  max?: number;
}[] = [
  { key: "cpu", query: (i) => Q.cpuPercent(i), unit: "percent", max: 100 },
  { key: "memory", query: (i) => Q.memoryPercent(i), unit: "percent", max: 100 },
  { key: "memoryUsed", query: (i) => Q.memoryUsedBytes(i), unit: "bytes" },
  { key: "load", query: (i) => Q.load1(i), unit: "number" },
  {
    key: "diskUsed",
    query: (i) =>
      `100 - (min(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"${i ? `,instance="${i}"` : ""}}) / min(node_filesystem_size_bytes{fstype!~"tmpfs|overlay"${i ? `,instance="${i}"` : ""}}) * 100)`,
    unit: "percent",
    max: 100,
  },
  { key: "temperature", query: (i) => `max(${Q.temperatures(i)})`, unit: "number", max: 90 },
  { key: "networkIn", query: (i) => `sum(${Q.networkRx(i)})`, unit: "bytes" },
  { key: "networkOut", query: (i) => `sum(${Q.networkTx(i)})`, unit: "bytes" },
  { key: "uptime", query: (i) => Q.uptimeSeconds(i), unit: "number" },
];

export async function prometheusHealth(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await prometheusConfig();
  if (!cfg) return { ok: false, error: "not configured" };
  try {
    const res = await fetch(`${cfg.url}/-/healthy`, {
      headers: auth(cfg),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
