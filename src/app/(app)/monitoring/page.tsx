import Link from "next/link";
import { pageUser } from "@/lib/pageUser";
// Resolved through integrations.ts, not through config.ts: these can be set in
// the interface as well as in .env, and reading only the environment here is
// what made a Prometheus configured from the settings page report itself as
// missing on this one.
import { prometheusConfig, proxmoxConfig } from "@/lib/integrations";
import { query, queryOne, queryRange, Q } from "@/lib/prometheus";
import { guests, storages } from "@/lib/proxmox";
import { smartDisks } from "@/lib/smart";
import { dict } from "@/i18n";
import { Card, CardHeader, Meter, Badge, EmptyState, SectionTitle } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { HoverChart } from "@/components/HoverChart";
import { ContainerLoadChart } from "@/components/containers/ContainerLoadChart";
import { AutoRefresh } from "@/components/AutoRefresh";
import { bytes, percent, duration } from "@/lib/format";
import { filesystemUsage } from "@/lib/filesystemUsage";

export const dynamic = "force-dynamic";

/**
 * How far back the charts reach. A single choice drives every range query on
 * the page, kept in the URL so "the window I always look at" survives a
 * bookmark and a refresh. `points` is tuned per range so a week does not ask
 * Prometheus for thousands of samples nobody can see.
 */
const RANGES = [
  { key: "15m", minutes: 15, points: 90 },
  { key: "1h", minutes: 60, points: 120 },
  { key: "3h", minutes: 180, points: 150 },
  { key: "12h", minutes: 720, points: 180 },
  { key: "24h", minutes: 1440, points: 200 },
  { key: "7d", minutes: 10080, points: 240 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function resolveRange(key?: string) {
  return RANGES.find((r) => r.key === key) ?? RANGES[2];
}

/**
 * Monitoring.
 *
 * One switcher across the top: an overview, then one view per machine that
 * reports to Prometheus, then Proxmox for the things only the hypervisor knows
 * — physical disks, SMART, guests. Which view is open is a URL parameter, so
 * "the page I always look at" is a bookmark.
 */
export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ host?: string; range?: string }>;
}) {
  const user = await pageUser();
  const d = dict(user.locale);
  const queryParams = await searchParams;
  const range = resolveRange(queryParams.range);

  const hasProm = (await prometheusConfig()) !== null;
  const hasPve = (await proxmoxConfig()) !== null;

  if (!hasProm && !hasPve) {
    return (
      <div className="space-y-3">
        <EmptyState title={d.monitoring.noPrometheus} hint={d.monitoring.noPrometheusHint} />
        <EmptyState title={d.monitoring.noProxmox} hint={d.monitoring.noProxmoxHint} />
      </div>
    );
  }

  // The machine list comes from Prometheus itself rather than from a list
  // someone has to maintain: a new node_exporter shows up here on its own.
  const instances = hasProm
    ? Array.from(new Set((await query(Q.instances())).map((s) => s.metric.instance).filter(Boolean))).sort()
    : [];

  const view = queryParams.host ?? "overview";

  const tabs = [
    { key: "overview", label: d.monitoring.allHosts },
    ...instances.map((i) => ({ key: i, label: i })),
    ...(hasProm ? [{ key: "containers", label: d.widgets.containers }] : []),
    ...(hasPve ? [{ key: "proxmox", label: "Proxmox" }] : []),
  ];

  // A link that keeps the host but swaps the range, and one that keeps the
  // range but swaps the host — so neither switcher throws away the other.
  const withRange = (r: RangeKey) => `/monitoring?host=${encodeURIComponent(view)}&range=${r}`;
  const withHost = (h: string) => `/monitoring?host=${encodeURIComponent(h)}&range=${range.key}`;

  // The range only means something where there are charts to stretch.
  const showRange = view !== "proxmox" && hasProm;

  return (
    <>
      <AutoRefresh seconds={30} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{d.monitoring.title}</h1>
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={withHost(tab.key)}
              className={`whitespace-nowrap rounded-control px-3 py-1.5 font-mono text-xs transition-colors ${
                view === tab.key ? "bg-raised text-text" : "text-muted hover:bg-raised hover:text-text"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {showRange && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{d.monitoring.range}</span>
          <div className="flex items-center gap-1 rounded-control border border-line p-0.5">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={withRange(r.key)}
                className={`rounded-[6px] px-2.5 py-1 font-mono text-xs transition-colors ${
                  range.key === r.key ? "bg-raised text-text" : "text-muted hover:text-text"
                }`}
              >
                {d.monitoring[`range${r.key}` as keyof typeof d.monitoring] as string}
              </Link>
            ))}
          </div>
        </div>
      )}

      {view === "overview" && <Overview d={d} instances={instances} hasPve={hasPve} range={range} />}
      {view === "containers" && hasProm && <ContainersView d={d} range={range} />}
      {view === "proxmox" && hasPve && <ProxmoxView d={d} />}
      {view !== "overview" && view !== "proxmox" && view !== "containers" && (
        <HostView d={d} instance={view} range={range} />
      )}
    </>
  );
}

type Range = (typeof RANGES)[number];

// ───────────────────────────────── Overview ──────────────────────────────

async function Overview({
  d,
  instances,
  hasPve,
  range,
}: {
  d: ReturnType<typeof dict>;
  instances: string[];
  hasPve: boolean;
  range: Range;
}) {
  return (
    <div className="space-y-6">
      {instances.length > 0 && (
        <section>
          <SectionTitle>{d.monitoring.host}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {instances.map((instance) => (
              <HostSummary key={instance} d={d} instance={instance} range={range} />
            ))}
          </div>
        </section>
      )}

      {hasPve && (
        <section>
          <SectionTitle>Proxmox</SectionTitle>
          <GuestTable d={d} />
        </section>
      )}
    </div>
  );
}

async function HostSummary({ d, instance, range }: { d: ReturnType<typeof dict>; instance: string; range: Range }) {
  const [cpu, mem, memUsed, memTotal, up, history] = await Promise.all([
    queryOne(Q.cpuPercent(instance)),
    queryOne(Q.memoryPercent(instance)),
    queryOne(Q.memoryUsedBytes(instance)),
    queryOne(Q.memoryTotalBytes(instance)),
    queryOne(Q.uptimeSeconds(instance)),
    queryRange(Q.cpuPercent(instance), range.minutes, range.points),
  ]);

  return (
    <Card>
      <CardHeader
        title={
          <Link href={withHostLink(instance, range)} className="font-mono text-xs hover:text-accent">
            {instance}
          </Link>
        }
        action={up ? <span className="font-mono text-[11px] text-faint">{duration(up)}</span> : null}
      />
      <div className="space-y-3 p-4">
        <Row label={d.monitoring.cpu} value={percent(cpu)} meter={cpu ?? 0} />
        <Row
          label={d.monitoring.memory}
          value={memUsed !== null && memTotal !== null ? `${bytes(memUsed)} / ${bytes(memTotal)}` : percent(mem)}
          meter={mem ?? 0}
        />
        {history[0] && <Sparkline points={history[0].points} min={0} max={100} />}
        <Link href={withHostLink(instance, range)} className="inline-block text-xs text-accent hover:underline">
          {d.common.next} →
        </Link>
      </div>
    </Card>
  );
}

function withHostLink(instance: string, range: Range) {
  return `/monitoring?host=${encodeURIComponent(instance)}&range=${range.key}`;
}

// ─────────────────────────────── Single host ─────────────────────────────

async function HostView({ d, instance, range }: { d: ReturnType<typeof dict>; instance: string; range: Range }) {
  const [
    cpuHistory,
    memHistory,
    swapHistory,
    diskReadHistory,
    diskWriteHistory,
    sizes,
    avail,
    temps,
    rx,
    tx,
    load1,
    load5,
    load15,
    cores,
    up,
  ] = await Promise.all([
    queryRange(Q.cpuPercent(instance), range.minutes, range.points),
    queryRange(Q.memoryPercent(instance), range.minutes, range.points),
    queryRange(Q.swapPercent(instance), range.minutes, range.points),
    queryRange(Q.diskReadBytes(instance), range.minutes, range.points),
    queryRange(Q.diskWriteBytes(instance), range.minutes, range.points),
    query(Q.filesystems(instance)),
    query(Q.filesystemsFree(instance)),
    query(Q.temperatures(instance)),
    query(Q.networkRx(instance)),
    query(Q.networkTx(instance)),
    queryOne(Q.load1(instance)),
    queryOne(Q.load5(instance)),
    queryOne(Q.load15(instance)),
    queryOne(Q.cpuCount(instance)),
    queryOne(Q.uptimeSeconds(instance)),
  ]);

  const filesystems = filesystemUsage(sizes, avail)
    .sort((a, b) => b.total - a.total);

  const hasSwap = (swapHistory[0]?.points ?? []).some(([, v]) => Number.isFinite(v) && v > 0);
  const hasDiskIo = (diskReadHistory[0]?.points.length ?? 0) > 1 || (diskWriteHistory[0]?.points.length ?? 0) > 1;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader
          title={d.monitoring.cpu}
          action={
            <span className="font-mono text-xs text-faint">
              {load1 !== null
                ? `${d.monitoring.load} ${load1.toFixed(2)} / ${(load5 ?? 0).toFixed(2)} / ${(load15 ?? 0).toFixed(2)}${
                    cores ? ` · ${cores} ${d.monitoring.cores}` : ""
                  }`
                : ""}
              {up ? ` · ${duration(up)}` : ""}
            </span>
          }
        />
        <div className="p-4">
          {cpuHistory[0] ? (
            <HoverChart d={d} points={cpuHistory[0].points} unit="percent" min={0} max={100} />
          ) : (
            <NoData d={d} />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title={d.monitoring.memory} />
        <div className="p-4">
          {memHistory[0] ? (
            <HoverChart d={d} points={memHistory[0].points} unit="percent" min={0} max={100} tone="ok" />
          ) : (
            <NoData d={d} />
          )}
        </div>
      </Card>

      {hasSwap && (
        <Card>
          <CardHeader title={d.monitoring.swap} />
          <div className="p-4">
            <HoverChart d={d} points={swapHistory[0].points} unit="percent" min={0} max={100} tone="warn" />
          </div>
        </Card>
      )}

      {hasDiskIo && (
        <Card className={hasSwap ? "" : "lg:col-span-2"}>
          <CardHeader title={d.monitoring.diskIo} />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] text-muted">↓ {d.monitoring.read}</p>
              {diskReadHistory[0] ? (
                <HoverChart d={d} points={diskReadHistory[0].points} unit="bytesPerSecond" min={0} />
              ) : (
                <NoData d={d} />
              )}
            </div>
            <div>
              <p className="mb-1 text-[11px] text-muted">↑ {d.monitoring.write}</p>
              {diskWriteHistory[0] ? (
                <HoverChart d={d} points={diskWriteHistory[0].points} unit="bytesPerSecond" min={0} tone="danger" />
              ) : (
                <NoData d={d} />
              )}
            </div>
          </div>
        </Card>
      )}

      <Card className="lg:col-span-2">
        <CardHeader title={d.monitoring.disks} />
        <div className="space-y-3 p-4">
          {filesystems.length === 0 && <NoData d={d} />}
          {filesystems.map((f) => (
            <div key={f.mount}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs">
                  {f.mount} <span className="text-faint">{f.device}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {f.used === null ? "—" : bytes(f.used)} / {bytes(f.total)} · {f.free === null ? "—" : bytes(f.free)} {d.monitoring.free}
                </span>
              </div>
              <Meter value={f.usedPercent ?? 0} />
            </div>
          ))}
        </div>
      </Card>

      {temps.length > 0 && (
        <Card>
          <CardHeader title={d.monitoring.temperature} />
          <div className="grid grid-cols-2 gap-2 p-4">
            {temps.slice(0, 8).map((t, i) => (
              <div key={`${t.metric.chip}-${t.metric.sensor}-${i}`} className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-muted">{t.metric.sensor ?? t.metric.chip}</span>
                <span className="font-mono text-sm tabular-nums">{t.value.toFixed(0)}°</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(rx.length > 0 || tx.length > 0) && (
        <Card>
          <CardHeader title={d.monitoring.network} />
          <div className="space-y-1.5 p-4">
            {rx.map((s, i) => (
              <div key={`${s.metric.device}-${i}`} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] text-muted">{s.metric.device}</span>
                <span className="font-mono text-xs tabular-nums">
                  ↓ {bytes(s.value)}/s ↑ {bytes(tx.find((t) => t.metric.device === s.metric.device)?.value ?? 0)}/s
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ───────────────────────────────── Proxmox ───────────────────────────────

async function ProxmoxView({ d }: { d: ReturnType<typeof dict> }) {
  const [smart, stores] = await Promise.all([smartDisks(), storages()]);
  const byNode = new Map<string, typeof smart>();
  for (const disk of smart) {
    const arr = byNode.get(disk.node) ?? [];
    arr.push(disk);
    byNode.set(disk.node, arr);
  }

  return (
    <div className="space-y-6">
      <GuestTable d={d} />

      <section>
        <SectionTitle>{d.monitoring.disks}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {[...byNode].map(([node, list]) => (
            <Card key={node}>
              <CardHeader title={<span className="font-mono text-xs">{node}</span>} />
              <div className="divide-y divide-line">
                {list.map((disk) => {
                  const c = disk.counters;
                  return (
                    <div key={disk.devpath} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs">{disk.devpath}</p>
                        <p className="truncate text-[11px] text-faint">
                          {disk.model} · {disk.sizeGB} GB · {disk.type}
                        </p>
                        {/* Failing-sector counters — the numbers that creep before a disk dies. */}
                        {(c.reallocated || c.pending || c.uncorrectable) ? (
                          <p className="mt-0.5 truncate font-mono text-[11px]">
                            {c.reallocated ? <span className="text-warn">realloc {c.reallocated}</span> : null}
                            {c.pending ? <span className="ml-1.5 text-danger">pending {c.pending}</span> : null}
                            {c.uncorrectable ? <span className="ml-1.5 text-danger">uncorr {c.uncorrectable}</span> : null}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {c.temperature !== null && (
                          <span
                            className={`font-mono text-[11px] tabular-nums ${
                              c.temperature >= 55 ? "text-danger" : c.temperature >= 50 ? "text-warn" : "text-faint"
                            }`}
                          >
                            {c.temperature}°
                          </span>
                        )}
                        {disk.wearout !== undefined && <span className="font-mono text-[11px] text-faint">{disk.wearout}%</span>}
                        <Badge tone={disk.health === "PASSED" ? "ok" : disk.health === "UNKNOWN" ? "neutral" : "danger"}>
                          {disk.health === "PASSED" ? d.monitoring.smartPassed : disk.health}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && <p className="px-4 py-3 text-sm text-muted">{d.widgets.noData}</p>}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>{d.monitoring.storage}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {stores.map((s) => (
            <Card key={`${s.node}-${s.storage}`} className="p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-xs">{s.storage}</span>
                <span className="font-mono text-[11px] text-faint">{s.node}</span>
              </div>
              <Meter value={s.total > 0 ? (s.used / s.total) * 100 : 0} />
              <p className="mt-1.5 font-mono text-[11px] tabular-nums text-muted">
                {bytes(s.used)} / {bytes(s.total)}
              </p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

async function GuestTable({ d }: { d: ReturnType<typeof dict> }) {
  const list = await guests();
  if (list.length === 0) return <NoData d={d} />;

  return (
    <Card>
      <CardHeader title={d.monitoring.guests} />
      {/* The table scrolls inside its own box; the page itself must never scroll
          sideways on a phone. */}
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Node</th>
              <th className="px-4 py-2 font-medium">CPU</th>
              <th className="px-4 py-2 font-medium">{d.monitoring.memory}</th>
              <th className="px-4 py-2 font-medium">{d.monitoring.uptime}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((g) => (
              <tr key={g.id}>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${g.status === "running" ? "bg-ok" : "bg-faint"}`}
                      aria-hidden
                    />
                    <Link
                      href={`/monitoring/guest/${encodeURIComponent(g.node)}/${g.type}/${g.vmid}`}
                      className="font-medium hover:text-accent"
                    >
                      {g.name || g.vmid}
                    </Link>
                    <span className="font-mono text-[11px] text-faint">{g.type}</span>
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted">{g.node}</td>
                <td className="px-4 py-2 font-mono text-xs tabular-nums">{(g.cpu * 100).toFixed(0)}%</td>
                <td className="px-4 py-2 font-mono text-xs tabular-nums">
                  {bytes(g.mem)} / {bytes(g.maxmem)}
                </td>
                <td className="px-4 py-2 font-mono text-xs tabular-nums text-muted">{duration(g.uptime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ───────────────────────────── Containers ────────────────────────────────

/**
 * Consumption per container, over the chosen range.
 *
 * The containers page answers "what is each one costing right now"; this answers
 * "how has it spent the last few hours", the busiest first, with a hoverable
 * chart for CPU and one for memory apiece. It needs cAdvisor's per-container
 * series from Prometheus — so it only appears where Prometheus does.
 */
async function ContainersView({ d, range }: { d: ReturnType<typeof dict>; range: Range }) {
  const [cpuSeries, memSeries] = await Promise.all([
    queryRange(Q.allContainerCpu(), range.minutes, range.points),
    queryRange(Q.allContainerMemory(), range.minutes, range.points),
  ]);

  const cpuBy = new Map(cpuSeries.filter((s) => s.metric.name).map((s) => [s.metric.name, s.points]));
  const memBy = new Map(memSeries.filter((s) => s.metric.name).map((s) => [s.metric.name, s.points]));
  const latest = (pts?: [number, number][]) => (pts && pts.length ? pts[pts.length - 1][1] : 0);

  // Busiest first — the point of the view is to find the hog, not to read an
  // alphabet. Capped so a host with a hundred containers stays a page.
  const names = [...new Set([...cpuBy.keys(), ...memBy.keys()])]
    .sort((a, b) => latest(cpuBy.get(b)) - latest(cpuBy.get(a)))
    .slice(0, 24);

  if (names.length === 0) return <NoData d={d} />;

  const cpuAll = [...cpuBy.entries()].map(([name, points]) => ({ name: name ?? "?", points }));
  const memAll = [...memBy.entries()].map(([name, points]) => ({ name: name ?? "?", points }));

  return (
    <div className="space-y-3">
      {/* The overall picture first: every container stacked into one band, so
          the total load and who is under it are read at a glance, with a
          hover that names the heaviest at any instant. */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title={d.monitoring.cpu} action={<span className="text-[11px] text-faint">{names.length}</span>} />
          <div className="p-3">
            <ContainerLoadChart series={cpuAll} unit="percent" />
          </div>
        </Card>
        <Card>
          <CardHeader title={d.monitoring.memory} action={<span className="text-[11px] text-faint">{names.length}</span>} />
          <div className="p-3">
            <ContainerLoadChart series={memAll} unit="bytes" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {names.map((name) => {
        const cpu = cpuBy.get(name);
        const mem = memBy.get(name);
        return (
          <Card key={name}>
            <CardHeader
              title={<span className="truncate font-mono text-xs">{name}</span>}
              action={
                <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-faint">
                  {percent(latest(cpu), 1)} · {bytes(latest(mem))}
                </span>
              }
            />
            <div className="space-y-3 p-4">
              <div>
                <p className="mb-1 text-[11px] text-muted">{d.monitoring.cpu}</p>
                {cpu && cpu.length > 1 ? (
                  <HoverChart d={d} points={cpu} unit="percent" min={0} height={72} />
                ) : (
                  <NoData d={d} />
                )}
              </div>
              <div>
                <p className="mb-1 text-[11px] text-muted">{d.monitoring.memory}</p>
                {mem && mem.length > 1 ? (
                  <HoverChart d={d} points={mem} unit="bytes" min={0} tone="ok" height={72} summary={false} />
                ) : (
                  <NoData d={d} />
                )}
              </div>
            </div>
          </Card>
        );
      })}
      </div>
    </div>
  );
}

function Row({ label, value, meter }: { label: string; value: string; meter: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-muted">{label}</span>
        <span className="font-mono text-sm tabular-nums">{value}</span>
      </div>
      <Meter value={meter} />
    </div>
  );
}

function NoData({ d }: { d: ReturnType<typeof dict> }) {
  return <p className="text-sm text-muted">{d.widgets.noData}</p>;
}
