import { Card, CardHeader, Meter, Badge } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { Clock } from "./Clock";
import { WorldClocks } from "./WorldClocks";
import { Countdown } from "./Countdown";
import { Markdown } from "@/components/Markdown";
import { query, queryOne, queryRange, Q } from "@/lib/prometheus";
import { guests, storages } from "@/lib/proxmox";
import { listContainers, statsForContainers } from "@/lib/docker";
import { prometheusConfig, proxmoxConfig, resolvedDockerHosts } from "@/lib/integrations";
import { Slideshow } from "./Slideshow";
import { NowPlayingWidget } from "./NowPlaying";
import { WeatherWidget } from "./Weather";
import { CalendarWidget } from "./Calendar";
import { JellyfinWidget, QbitWidget, ArrWidget, PbsWidget, HomeAssistantWidget } from "./Services";
import { MediaPlayerWidget } from "./MediaPlayer";
import { HomeGroups } from "./HomeGroups";
import { Scenes } from "./Scenes";
import { haConfig, haMediaPlayers, haStates, haCameras } from "@/lib/services";
import { Cameras } from "./Cameras";
import { getSetting } from "@/lib/db";
import { EMPTY_HOME, HOME_CONFIG_KEY, normalizeHome } from "@/lib/homeConfig";
import { RemindersWidget } from "./Reminders";
import { Gauge } from "@/components/Gauge";
import { Chart } from "@/components/Chart";
import { prisma } from "@/lib/db";
import { uptimeBuckets } from "@/lib/status";
import { uptimeRatio } from "@/lib/monitor";
import { readFeed } from "@/lib/feeds";
import { readIcal } from "@/lib/ical";
import { Wol, type WolMachine } from "./Wol";
import { ShoppingList } from "./ShoppingList";
import { getShopping } from "@/lib/shopping";
import { NutritionDiary } from "./NutritionDiary";
import { getNutrition } from "@/actions/nutrition";
import { Habits } from "./Habits";
import { habitsState } from "@/lib/habits";
import { upcomingEvents } from "@/lib/google";
import { getProfile, computeTargets } from "@/lib/nutrition";
import { NetMonitor } from "./NetMonitor";
import { LinksWidget } from "./Links";
import { smartDisks } from "@/lib/smart";
import { internetSamples } from "@/lib/netmon";
import { bytes, percent, duration, ago } from "@/lib/format";
import { filesystemUsage } from "@/lib/filesystemUsage";
import { groupRecentEvents } from "@/lib/eventGroups";
import type { Dictionary } from "@/i18n";

/**
 * Widgets.
 *
 * Each one is a server component that fetches its own data and renders whatever
 * it managed to get. That isolation is the point: a Prometheus that stops
 * answering turns one card into "no data" instead of taking the dashboard down
 * with it, and adding a widget kind means adding a case here and nothing else.
 */

export type WidgetProps = {
  widget: string;
  config: Record<string, unknown>;
  title: string;
  d: Dictionary;
  /** Who is looking — the calendar is personal to them. */
  userId?: string;
  /** Whether this viewer may operate the house, not only watch it. */
  canControl?: boolean;
};

export async function Widget({ widget, config, title, d, userId, canControl = false }: WidgetProps) {
  switch (widget) {
    case "system":
      return <SystemWidget config={config} title={title} d={d} />;
    case "disks":
      return <DisksWidget config={config} title={title} d={d} />;
    case "chart":
      return <ChartWidget config={config} title={title} d={d} />;
    case "containers":
      return <ContainersWidget title={title} d={d} />;
    case "proxmox":
      return <ProxmoxWidget title={title} d={d} />;
    case "clock":
      return <Clock title={title} timeZone={str(config.timeZone)} />;
    case "worldclocks":
      return <WorldClocks title={title} zones={lines(config.zones)} />;
    case "countdown":
      return <Countdown d={d} title={title} target={str(config.target) ?? ""} label={str(config.label)} />;
    case "slideshow":
      return (
        <Slideshow
          images={lines(config.images)}
          intervalSeconds={num(config.intervalSeconds, 20)}
          caption={str(config.caption)}
          fit={str(config.fit) === "contain" ? "contain" : "cover"}
        />
      );
    case "nowplaying":
      return <NowPlayingWidget title={title} d={d} />;
    case "load":
      return <LoadWidget config={config} title={title} d={d} />;
    case "weather":
      return <WeatherWidget config={config} title={title} d={d} />;
    case "calendar":
      return userId ? (
        <CalendarWidget config={config} title={title} d={d} userId={userId} />
      ) : (
        <Card className="p-4">
          <p className="text-sm text-muted">{d.widgets.noData}</p>
        </Card>
      );
    case "gauge":
      return <GaugeWidget config={config} title={title} d={d} />;
    case "uptimestrip":
      return <UptimeStripWidget config={config} title={title} d={d} />;
    case "jellyfin":
      return <JellyfinWidget title={title} d={d} config={config} />;
    case "qbittorrent":
      return <QbitWidget title={title} d={d} />;
    case "arr":
      return <ArrWidget title={title} d={d} />;
    case "pbs":
      return <PbsWidget title={title} d={d} />;
    case "homeassistant":
      return <HomeAssistantWidget config={config} title={title} d={d} />;
    case "mediaplayer":
      return <MediaWidget config={config} title={title} d={d} canControl={canControl} />;
    case "homegroups":
      return <HomeGroupsWidget config={config} title={title} d={d} canControl={canControl} />;
    case "scenes":
      return <ScenesWidget config={config} title={title} d={d} canControl={canControl} />;
    case "energy":
      return <EnergyWidget config={config} title={title} d={d} />;
    case "cameras":
      return <CamerasWidget config={config} title={title} d={d} />;
    case "netmon":
      return <NetMonWidget title={title} d={d} />;
    case "reminders":
      return userId ? (
        <RemindersList title={title} d={d} userId={userId} />
      ) : (
        <Card className="p-4">
          <p className="text-sm text-muted">{d.widgets.noData}</p>
        </Card>
      );
    case "feed":
      return <FeedWidget config={config} title={title} d={d} />;
    case "embed":
      return <EmbedWidget config={config} title={title} d={d} />;
    case "recentevents":
      return <RecentEventsWidget config={config} title={title} d={d} />;
    case "sla":
      return <SlaWidget config={config} title={title} d={d} />;
    case "ical":
      return <IcalWidget config={config} title={title} d={d} />;
    case "airquality":
      return <AirQualityWidget config={config} title={title} d={d} />;
    case "rates":
      return <RatesWidget config={config} title={title} d={d} />;
    case "wol":
      return <WolWidget config={config} title={title} d={d} canControl={canControl} />;
    case "shopping":
      return <ShoppingWidget title={title} d={d} canControl={canControl} />;
    case "presence":
      return <PresenceWidget title={title} d={d} />;
    case "nutrition":
      return userId ? (
        <NutritionWidget title={title} d={d} canControl={canControl} />
      ) : (
        <Card className="p-4">
          <p className="text-sm text-muted">{d.widgets.noData}</p>
        </Card>
      );
    case "habits":
      return userId ? (
        <HabitsWidget title={title} d={d} config={config} userId={userId} canControl={canControl} />
      ) : (
        <Card className="p-4">
          <p className="text-sm text-muted">{d.widgets.noData}</p>
        </Card>
      );
    case "agenda":
      return userId ? (
        <AgendaWidget title={title} d={d} userId={userId} />
      ) : (
        <Card className="p-4">
          <p className="text-sm text-muted">{d.widgets.noData}</p>
        </Card>
      );
    case "notes":
      return <NotesWidget title={title} text={str(config.text) ?? ""} />;
    case "links":
      return <LinksWidget title={title} links={linkList(config.links)} />;
    case "diskhealth":
      return <DiskHealthWidget title={title} d={d} />;
    default:
      return (
        <Card className="p-4">
          <p className="text-sm text-muted">{d.widgets.noData}</p>
        </Card>
      );
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Multi-line textarea input as a list — how URLs are entered in the dialog. */
function lines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return typeof v === "string" ? v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : [];
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * "Label | https://addr" per line → shortcuts. The label is optional (the host
 * stands in for it), and a scheme-less address is treated as a LAN box and
 * opened over http rather than guessing https on a machine that has no cert.
 */
function linkList(v: unknown): { label: string; url: string }[] {
  if (typeof v !== "string") return [];
  return v
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return null;
      const bar = t.indexOf("|");
      let label = bar === -1 ? "" : t.slice(0, bar).trim();
      let url = (bar === -1 ? t : t.slice(bar + 1)).trim();
      if (!url) return null;
      if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) url = `http://${url}`;
      if (!label) {
        try {
          label = new URL(url).host;
        } catch {
          label = url;
        }
      }
      return { label, url };
    })
    .filter((x): x is { label: string; url: string } => x !== null);
}

/** Shown wherever a widget needs an integration the operator has not set up. */
function NotConfigured({ title, message, hint }: { title: string; message: string; hint: string }) {
  return (
    <Card className="h-full">
      <CardHeader title={title} />
      <div className="p-4">
        <p className="text-sm font-medium text-muted">{message}</p>
        <p className="mt-1 text-xs text-faint">{hint}</p>
      </div>
    </Card>
  );
}

// ───────────────────────────────── System ────────────────────────────────

async function SystemWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  if (!(await prometheusConfig())) {
    return <NotConfigured title={title} message={d.monitoring.noPrometheus} hint={d.monitoring.noPrometheusHint} />;
  }
  const instance = str(config.instance);

  // One await for everything: the numbers belong to the same moment, and four
  // sequential queries would show as a visible stagger on a slow Prometheus.
  const [cpu, memPercent, memUsed, memTotal, load, up, cpuHistory] = await Promise.all([
    queryOne(Q.cpuPercent(instance)),
    queryOne(Q.memoryPercent(instance)),
    queryOne(Q.memoryUsedBytes(instance)),
    queryOne(Q.memoryTotalBytes(instance)),
    queryOne(Q.load1(instance)),
    queryOne(Q.uptimeSeconds(instance)),
    queryRange(Q.cpuPercent(instance), num(config.rangeMinutes, 60), 60),
  ]);

  return (
    <Card className="h-full">
      <CardHeader
        icon="🖥️"
        title={title}
        action={up ? <span className="font-mono text-xs text-faint">{duration(up)}</span> : null}
      />
      <div className="space-y-3 p-4">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs text-muted">{d.monitoring.cpu}</span>
            <span className="font-mono text-sm tabular-nums">{percent(cpu)}</span>
          </div>
          <Meter value={cpu ?? 0} />
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs text-muted">{d.monitoring.memory}</span>
            <span className="font-mono text-sm tabular-nums">
              {memUsed && memTotal ? `${bytes(memUsed)} / ${bytes(memTotal)}` : percent(memPercent)}
            </span>
          </div>
          <Meter value={memPercent ?? 0} />
        </div>

        {cpuHistory.length > 0 && <Sparkline points={cpuHistory[0].points} min={0} max={100} />}

        {load !== null && (
          <p className="font-mono text-xs text-faint">
            {d.monitoring.load}: {load.toFixed(2)}
          </p>
        )}
      </div>
    </Card>
  );
}

// ────────────────────────────────── Disks ────────────────────────────────

async function DisksWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  if (!(await prometheusConfig())) {
    return <NotConfigured title={title} message={d.monitoring.noPrometheus} hint={d.monitoring.noPrometheusHint} />;
  }
  const instance = str(config.instance);
  const [sizes, avail] = await Promise.all([query(Q.filesystems(instance)), query(Q.filesystemsFree(instance))]);

  const rows = filesystemUsage(sizes, avail)
    // Fullest first: the one about to cause a problem should be the one you see.
    .sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1))
    .slice(0, num(config.limit, 6));

  return (
    <Card className="h-full">
      <CardHeader icon="💾" title={title} />
      <div className="space-y-2.5 p-4">
        {rows.length === 0 && <p className="text-sm text-muted">{d.widgets.noData}</p>}
        {rows.map((r) => (
          <div key={`${r.instance}${r.mount}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-xs text-muted" title={r.mount}>
                {r.mount}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-faint">
                {r.free === null ? "—" : bytes(r.free)} {d.monitoring.free}
              </span>
            </div>
            <Meter value={r.usedPercent ?? 0} />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────── Chart ────────────────────────────────

async function ChartWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  if (!(await prometheusConfig())) {
    return <NotConfigured title={title} message={d.monitoring.noPrometheus} hint={d.monitoring.noPrometheusHint} />;
  }
  const promql = str(config.query);
  if (!promql) {
    return (
      <Card className="h-full">
        <CardHeader title={title} />
        <p className="p-4 text-sm text-muted">{d.widgets.queryHint}</p>
      </Card>
    );
  }

  const minutes = num(config.rangeMinutes, 180);
  const unit = str(config.unit) ?? "number";
  // A query may return many series (one per device, per mount, per core), and a
  // second query can be added to put two different metrics on one axis.
  const queries = [promql, str(config.query2)].filter(Boolean) as string[];
  const results = await Promise.all(queries.map((q) => queryRange(q, minutes)));

  const format = (v: number) => (unit === "percent" ? percent(v, 1) : unit === "bytes" ? bytes(v) : v.toFixed(2));

  const series = results
    .flatMap((result, qi) =>
      result.map((s) => ({
        label: seriesLabel(s.metric) || (queries.length > 1 ? `#${qi + 1}` : title),
        points: s.points,
      }))
    )
    .slice(0, 5);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        icon="📈"
        title={title}
        action={
          series[0]?.points.at(-1) ? (
            <span className="font-mono text-xs tabular-nums text-faint">{format(series[0].points.at(-1)![1])}</span>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 p-4">
        {series.length > 0 ? (
          <Chart
            series={series}
            min={unit === "percent" ? 0 : undefined}
            max={unit === "percent" ? 100 : undefined}
            format={format}
            legend={series.length > 1}
          />
        ) : (
          <p className="text-sm text-muted">{d.widgets.noData}</p>
        )}
      </div>
    </Card>
  );
}

/**
 * A readable name for one series out of its Prometheus labels.
 *
 * The interesting label is whichever one distinguishes the series — device,
 * mount point, container — and never the metric name, which is the same for
 * all of them and would make the legend a column of identical words.
 */
function seriesLabel(metric: Record<string, string>): string {
  for (const key of ["name", "device", "mountpoint", "instance", "sensor", "chip", "cpu", "job"]) {
    if (metric[key]) return metric[key];
  }
  const entries = Object.entries(metric).filter(([k]) => k !== "__name__");
  return entries.length > 0 ? entries[0][1] : "";
}

// ──────────────────────────────── Containers ─────────────────────────────

async function ContainersWidget({ title, d }: { title: string; d: Dictionary }) {
  if ((await resolvedDockerHosts()).length === 0) {
    return <NotConfigured title={title} message={d.containers.noDocker} hint={d.containers.noDockerHint} />;
  }
  const containers = await listContainers();
  const running = containers.filter((c) => c.state === "running").length;
  const stopped = containers.filter((c) => c.state !== "running");

  return (
    <Card className="h-full">
      <CardHeader icon="🐳" title={title} />
      <div className="p-4">
        <p className="font-mono text-2xl tabular-nums">
          {running}
          <span className="text-base text-faint"> / {containers.length}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">{d.status.running}</p>
        {stopped.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stopped.slice(0, 8).map((c) => (
              <Badge key={c.id} tone="danger">
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ────────────────────────────────── Proxmox ──────────────────────────────

/**
 * Disk health at a glance: the SMART verdict and the failing-sector counters
 * that creep up before a drive dies — the same numbers the monitoring page
 * shows, pinned where you actually look. Any pending or uncorrectable sector,
 * or a health verdict that is not PASSED, turns the badge red.
 */
async function DiskHealthWidget({ title, d }: { title: string; d: Dictionary }) {
  if (!(await proxmoxConfig())) {
    return <NotConfigured title={title} message={d.monitoring.noProxmox} hint={d.monitoring.noProxmoxHint} />;
  }
  const disks = await smartDisks();
  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="🩺" title={title} />
      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {disks.length === 0 && <p className="p-4 text-sm text-muted">{d.widgets.noData}</p>}
        {disks.map((disk) => {
          const c = disk.counters;
          return (
            <div key={`${disk.node}-${disk.devpath}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">{disk.devpath}</p>
                <p className="truncate text-[11px] text-faint">
                  {disk.model} · {disk.sizeGB} GB
                </p>
                {c.reallocated || c.pending || c.uncorrectable ? (
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
      </div>
    </Card>
  );
}

async function ProxmoxWidget({ title, d }: { title: string; d: Dictionary }) {
  if (!(await proxmoxConfig())) {
    return <NotConfigured title={title} message={d.monitoring.noProxmox} hint={d.monitoring.noProxmoxHint} />;
  }
  const [vms, stores] = await Promise.all([guests(), storages()]);
  const running = vms.filter((g) => g.status === "running").length;

  return (
    <Card className="h-full">
      <CardHeader icon="🗄️" title={title} />
      <div className="space-y-3 p-4">
        <div>
          <p className="font-mono text-2xl tabular-nums">
            {running}
            <span className="text-base text-faint"> / {vms.length}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">{d.monitoring.guests}</p>
        </div>
        {stores.slice(0, 4).map((s) => (
          <div key={`${s.node}-${s.storage}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-xs text-muted">{s.storage}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-faint">{bytes(s.avail)}</span>
            </div>
            <Meter value={s.total > 0 ? (s.used / s.total) * 100 : 0} />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ───────────────────────────────── Reminders ─────────────────────────────

/**
 * The list is read here, on the server, and handed to the client component that
 * edits it — so the tile is filled in on first paint rather than after a fetch.
 */
async function RemindersList({ title, d, userId }: { title: string; d: Dictionary; userId: string }) {
  const rows = await prisma.reminder.findMany({
    where: { userId, done: false },
    orderBy: { at: "asc" },
    take: 20,
  });

  return (
    <RemindersWidget
      d={d}
      title={title}
      rows={rows.map((r) => ({ id: r.id, title: r.title, at: r.at.toISOString(), repeat: r.repeat }))}
    />
  );
}

// ─────────────────────────────── Gauge ───────────────────────────────────

/**
 * One number on a dial.
 *
 * The same data a chart would show, minus the history — for the values where
 * "right now" is the whole question: how full is the disk, how hot is the CPU.
 */
async function GaugeWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  if (!(await prometheusConfig())) {
    return <NotConfigured title={title} message={d.monitoring.noPrometheus} hint={d.monitoring.noPrometheusHint} />;
  }

  const promql = str(config.query);
  if (!promql) {
    return (
      <Card className="h-full">
        <CardHeader title={title} />
        <p className="p-4 text-sm text-muted">{d.widgets.queryHint}</p>
      </Card>
    );
  }

  const unit = str(config.unit) ?? "percent";
  const value = await queryOne(promql);
  const min = num(config.min, 0);
  const max = num(config.max, unit === "percent" ? 100 : 0) || autoMax(value);

  const label =
    value === null ? "—" : unit === "percent" ? percent(value, 0) : unit === "bytes" ? bytes(value) : value.toFixed(1);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="🎛️" title={title} />
      <div className="flex flex-1 items-center justify-center p-3">
        <Gauge
          value={value}
          min={min}
          max={max}
          label={label}
          caption={str(config.caption)}
          thresholds={{ warn: num(config.warn, max * 0.75), danger: num(config.danger, max * 0.9) }}
        />
      </div>
    </Card>
  );
}

/** A sensible ceiling when none was given: round the current value up. */
function autoMax(value: number | null): number {
  if (value === null || value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude || 100;
}

// ───────────────────────────── Uptime strip ──────────────────────────────

/**
 * A row per service, a block per slice of time, green where it answered.
 *
 * This is the one view that says "it has been fine all week" or "it drops out
 * every night", which no single status dot can.
 */
async function UptimeStripWidget({
  config,
  title,
  d,
}: {
  config: Record<string, unknown>;
  title: string;
  d: Dictionary;
}) {
  const hours = num(config.hours, 24);
  const blocks = num(config.blocks, 40);
  const only = lines(config.items);

  const items = await prisma.item.findMany({
    where: { checkKind: { not: "none" } },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
  const chosen = (only.length > 0 ? items.filter((i) => only.includes(i.title)) : items).slice(0, num(config.limit, 8));
  const buckets = await uptimeBuckets(
    chosen.map((i) => i.id),
    hours,
    blocks
  );

  return (
    <Card className="h-full">
      <CardHeader icon="📶" title={title} action={<span className="text-[11px] text-faint">{hours} h</span>} />
      <div className="space-y-2 p-4">
        {chosen.length === 0 && <p className="text-sm text-muted">{d.widgets.noData}</p>}
        {chosen.map((item) => {
          const strip = buckets.get(item.id) ?? [];
          const total = strip.reduce((n, b) => n + b.total, 0);
          const ok = strip.reduce((n, b) => n + b.ok, 0);
          return (
            <div key={item.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs">{item.title}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                  {total > 0 ? percent((ok / total) * 100, 1) : "—"}
                </span>
              </div>
              <div className="flex h-4 gap-[2px]">
                {strip.map((bucket, i) => (
                  <span
                    key={i}
                    title={bucket.total === 0 ? d.status.unknown : percent((bucket.ok / bucket.total) * 100, 0)}
                    className={`flex-1 rounded-[2px] ${
                      bucket.total === 0
                        ? "bg-line/60"
                        : bucket.ok === bucket.total
                          ? "bg-ok"
                          : bucket.ok === 0
                            ? "bg-danger"
                            : "bg-warn"
                    }`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ────────────────────────── Container load ───────────────────────────────

/**
 * Which containers are actually using the machine.
 *
 * Sorted by CPU by default, because the question this answers is almost always
 * "what is making the fans spin". A list of names in the config narrows it to
 * the ones worth watching; empty means everything, top N.
 */
async function LoadWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  const only = lines(config.containers);
  const sortBy = str(config.sortBy) === "memory" ? "memory" : "cpu";
  const limit = num(config.limit, 6);
  const hasPrometheus = (await prometheusConfig()) !== null;

  let rows: { name: string; cpu: number; memory: number }[] = [];

  if (hasPrometheus) {
    const [cpu, mem] = await Promise.all([query(Q.allContainerCpu()), query(Q.allContainerMemory())]);
    const memBy = new Map(mem.map((s) => [s.metric.name, s.value]));
    rows = cpu.map((s) => ({ name: s.metric.name ?? "?", cpu: s.value, memory: memBy.get(s.metric.name) ?? 0 }));
  } else if ((await resolvedDockerHosts()).length > 0) {
    // No cAdvisor: ask Docker itself. Running containers only — a stopped one
    // has no statistics and would block the request waiting for them.
    const running = (await listContainers()).filter((c) => c.state === "running");
    const chosen = only.length > 0 ? running.filter((c) => only.includes(c.name)) : running;
    rows = (await statsForContainers(chosen, Math.max(limit, 12))).map((s) => ({
      name: s.name,
      cpu: s.cpu,
      memory: s.memory,
    }));
  } else {
    return <NotConfigured title={title} message={d.monitoring.noPrometheus} hint={d.monitoring.noPrometheusHint} />;
  }

  rows = rows
    .filter((r) => (only.length === 0 ? true : only.includes(r.name)))
    .sort((a, b) => (sortBy === "memory" ? b.memory - a.memory : b.cpu - a.cpu))
    .slice(0, limit);

  // Bars are relative to the busiest row rather than to 100%: a host idling at
  // 3% would otherwise draw six identical empty bars.
  const peak = Math.max(...rows.map((r) => (sortBy === "memory" ? r.memory : r.cpu)), 0.0001);

  return (
    <Card className="h-full">
      <CardHeader
        icon="📊"
        title={title}
        action={<span className="text-[11px] text-faint">{hasPrometheus ? sortBy : `${sortBy} · docker`}</span>}
      />
      <div className="space-y-2 p-4">
        {rows.length === 0 && <p className="text-sm text-muted">{d.widgets.noData}</p>}
        {rows.map((r) => (
          <div key={r.name}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-xs" title={r.name}>
                {r.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                {percent(r.cpu, 1)} · {bytes(r.memory)}
              </span>
            </div>
            <Meter value={((sortBy === "memory" ? r.memory : r.cpu) / peak) * 100} tone="ok" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────────────── Media player ────────────────────────────

/**
 * The speaker's remote.
 *
 * The first paint comes from the server, like every other widget, so the tile is
 * already showing the cover when the page arrives; the client component takes
 * over from there and polls, because a remote that is ten seconds stale is a
 * remote you press twice.
 *
 * With no entities configured it adopts whichever player is playing — a house
 * usually has one thing making noise, and asking which is a question the panel
 * can answer itself.
 */
async function MediaWidget({
  config,
  title,
  d,
  canControl,
}: {
  config: Record<string, unknown>;
  title: string;
  d: Dictionary;
  canControl: boolean;
}) {
  if (!(await haConfig())) {
    return <NotConfigured title={title} message={d.home.notConfigured} hint={d.home.notConfiguredHint} />;
  }

  const chosen = lines(config.entities);
  const players = await haMediaPlayers(chosen.length > 0 ? chosen : undefined);

  if (!players || players.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader title={title} icon="🔊" />
        <p className="p-4 text-sm text-muted">{d.media.noPlayers}</p>
      </Card>
    );
  }

  // Unconfigured: whatever is playing leads, and a house with nothing playing
  // gets its first player rather than an empty tile.
  const shown =
    chosen.length > 0
      ? players
      : [...players].sort((a, b) => Number(b.state === "playing") - Number(a.state === "playing")).slice(0, 4);

  // The like button exists only once the operator has said what "like" means on
  // their speaker; there is no sensible default for a phrase in someone else's
  // language spoken to someone else's assistant.
  const phrase = str(config.likePhrase);
  const like = phrase
    ? { service: str(config.likeService) ?? "media_player.play_media", phrase, label: str(config.likeLabel) }
    : null;

  return (
    <MediaPlayerWidget
      d={d}
      title={title}
      players={shown}
      canControl={canControl}
      background={background(config.background)}
      like={like}
    />
  );
}

// ─────────────────────────────── Home groups ─────────────────────────────

/**
 * The smart-home groups on the board — the same groups the smart-home page
 * uses, with a switch per device and a dimmer per light. Server-fetched like
 * every widget; the switching is a client component handed the result.
 */
async function HomeGroupsWidget({
  config,
  title,
  d,
  canControl,
}: {
  config: Record<string, unknown>;
  title: string;
  d: Dictionary;
  canControl: boolean;
}) {
  if (!(await haConfig())) {
    return <NotConfigured title={title} message={d.home.notConfigured} hint={d.home.notConfiguredHint} />;
  }

  const [entities, configRaw] = await Promise.all([
    haStates(),
    getSetting<unknown>(HOME_CONFIG_KEY, EMPTY_HOME),
  ]);
  if (!entities) return <NotConfigured title={title} message={d.home.unreachable} hint={d.home.notConfiguredHint} />;

  return (
    <HomeGroups
      d={d}
      title={title}
      canControl={canControl}
      config={normalizeHome(configRaw)}
      showGroups={lines(config.groups)}
      groupBy={str(config.groupBy) === "device" ? "device" : "area"}
      entities={entities.map((e) => ({
        id: e.id,
        name: e.name,
        state: e.state,
        domain: e.domain,
        toggleable: e.toggleable,
        area: e.area,
        device: e.device,
        brightness: e.brightness,
        rgb: e.rgb,
        supportsColor: e.supportsColor,
        supportsColorTemp: e.supportsColorTemp,
      }))}
    />
  );
}

// ──────────────────────────────── Energy ─────────────────────────────────

/**
 * What the house is drawing right now, from Home Assistant's power sensors.
 *
 * Anything classed as power (watts) is listed biggest first with a bar relative
 * to the hungriest, and the total across them sits at the top — the answer to
 * "what is on and costing me". Energy sensors (kWh) are listed under it for the
 * running totals. Auto-detected from the sensors' device class, or narrowed to
 * a chosen set.
 */
async function EnergyWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  if (!(await haConfig())) {
    return <NotConfigured title={title} message={d.home.notConfigured} hint={d.home.notConfiguredHint} />;
  }
  const entities = await haStates();
  if (!entities) return <NotConfigured title={title} message={d.home.unreachable} hint={d.home.notConfiguredHint} />;

  const only = lines(config.entities);
  const chosen = (e: { id: string }) => only.length === 0 || only.includes(e.id);
  const val = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

  const power = entities
    .filter((e) => e.deviceClass === "power" && chosen(e))
    .map((e) => ({ id: e.id, name: e.name, w: e.unit === "kW" ? val(e.state) * 1000 : val(e.state) }))
    .filter((e) => e.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, num(config.limit, 8));

  // Optional price per kWh turns the raw watts into a running cost — "what is
  // this costing me right now", and what each meter has cost so far.
  const price = num(config.price, 0);
  const currency = str(config.currency) ?? "₽";
  const money = (v: number) => `${v.toFixed(v < 10 ? 2 : 0)} ${currency}`;

  const energy = entities
    .filter((e) => e.deviceClass === "energy" && chosen(e))
    .map((e) => {
      const kwh = val(e.state);
      const cost = price > 0 ? ` · ${money(kwh * price)}` : "";
      return { id: e.id, name: e.name, label: `${kwh} ${e.unit ?? "kWh"}${cost}` };
    })
    .slice(0, 4);

  if (power.length === 0 && energy.length === 0) {
    return <NotConfigured title={title} message={d.widgets.noPower} hint={d.home.notConfiguredHint} />;
  }

  const total = power.reduce((sum, p) => sum + p.w, 0);
  const peak = Math.max(...power.map((p) => p.w), 1);
  const perHour = price > 0 ? (total / 1000) * price : null;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title={title}
        icon="⚡"
        action={
          <span className="font-mono text-xs text-faint">
            {Math.round(total)} W{perHour !== null && ` · ${money(perHour)}/${d.widgets.perHour}`}
          </span>
        }
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {power.map((p) => (
          <div key={p.id}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-xs">{p.name}</span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{Math.round(p.w)} W</span>
            </div>
            <Meter value={(p.w / peak) * 100} tone="warn" />
          </div>
        ))}
        {energy.length > 0 && (
          <div className="space-y-1 border-t border-line pt-2">
            {energy.map((e) => (
              <div key={e.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-muted">{e.name}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{e.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ──────────────────────────────── Scenes ─────────────────────────────────

/** Scenes and scripts as one-tap buttons, filtered to a chosen set if given. */
async function ScenesWidget({
  config,
  title,
  d,
  canControl,
}: {
  config: Record<string, unknown>;
  title: string;
  d: Dictionary;
  canControl: boolean;
}) {
  if (!(await haConfig())) {
    return <NotConfigured title={title} message={d.home.notConfigured} hint={d.home.notConfiguredHint} />;
  }
  const entities = await haStates();
  if (!entities) return <NotConfigured title={title} message={d.home.unreachable} hint={d.home.notConfiguredHint} />;

  const only = lines(config.entities);
  const items = entities
    .filter((e) => e.domain === "scene" || e.domain === "script")
    .filter((e) => only.length === 0 || only.includes(e.id))
    .map((e) => ({ id: e.id, name: e.name, domain: e.domain }));

  return <Scenes d={d} title={title} items={items} canControl={canControl} />;
}

/** The wall behind the full-screen player, as configured. */
function background(value: unknown): "drift" | "aurora" | "waves" | "beams" | "pulse" | "still" {
  const known = ["drift", "aurora", "waves", "beams", "pulse", "still"] as const;
  const found = known.find((k) => k === value);
  return found ?? "drift";
}

// ─────────────────────────────────── Note ────────────────────────────────

// ────────────────────────────────── Feed ─────────────────────────────────

/** An RSS/Atom feed — releases, a blog, the news — as a list of latest items. */
async function FeedWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  const url = str(config.url);
  if (!url) {
    return (
      <Card className="h-full">
        <CardHeader icon="📰" title={title} />
        <p className="p-4 text-sm text-muted">{d.widgets.feedHint}</p>
      </Card>
    );
  }
  const feed = await readFeed(url, num(config.limit, 8));
  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="📰" title={title} />
      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {!feed || feed.items.length === 0 ? (
          <p className="p-4 text-sm text-muted">{d.widgets.noData}</p>
        ) : (
          feed.items.map((item, i) => (
            <a
              key={i}
              href={item.link || "#"}
              target="_blank"
              rel="noreferrer"
              className="block px-4 py-2 transition-colors hover:bg-raised"
            >
              <p className="truncate text-sm" title={item.title}>
                {item.title}
              </p>
              {item.at > 0 && <p className="text-[11px] text-faint">{ago(item.at, d)}</p>}
            </a>
          ))
        )}
      </div>
    </Card>
  );
}

// ────────────────────────────────── Embed ────────────────────────────────

/** Any web page in a tile — a Grafana panel, a camera, another dashboard. */
async function EmbedWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  const url = str(config.url);
  if (!url) {
    return (
      <Card className="h-full">
        <CardHeader icon="🖼️" title={title} />
        <p className="p-4 text-sm text-muted">{d.widgets.embedHint}</p>
      </Card>
    );
  }
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader icon="🖼️" title={title} />
      {/* A page the operator chose to embed; sandboxed but allowed to run and
          navigate within itself. */}
      <iframe
        src={url}
        title={title}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </Card>
  );
}

// ────────────────────────────── Recent events ────────────────────────────

/** The latest entries from the event feed, on the board. */
async function RecentEventsWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  const limit = num(config.limit, 8);
  const rows = await prisma.event.findMany({
    orderBy: { at: "desc" },
    take: limit * 4,
    include: { item: { select: { title: true } } },
  });
  const events = groupRecentEvents(rows).slice(0, limit);

  const label: Record<string, string> = {
    down: d.events.wentDown,
    up: d.events.cameUp,
    restart: d.events.restarted,
    login: d.events.signedIn,
    command: d.events.command,
    system: d.events.system,
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="🔔" title={title} />
      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {events.length === 0 ? (
          <p className="p-4 text-sm text-muted">{d.events.empty}</p>
        ) : (
          events.map((e) => (
            <div key={e.id} className="flex items-start gap-2 px-4 py-2">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  e.severity === "error" ? "bg-danger" : e.severity === "warn" ? "bg-warn" : "bg-ok"
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-medium">{e.item?.title ?? e.title}</span>{" "}
                  <span className="text-muted">{label[e.type] ?? e.type}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {e.count > 1 && <span className="text-[11px] text-faint">×{e.count}</span>}
                <span className="text-[11px] text-faint">{ago(e.at, d)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────────── SLA ─────────────────────────────────

/** Hard uptime numbers for the services you watch, over a chosen window. */
async function SlaWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  const only = lines(config.items);
  const hours = num(config.hours, 24);
  const all = await prisma.item.findMany({
    where: { checkKind: { not: "none" } },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
  const chosen = (only.length > 0 ? all.filter((i) => only.includes(i.title)) : all).slice(0, num(config.limit, 10));
  const rows = await Promise.all(chosen.map(async (i) => ({ title: i.title, pct: await uptimeRatio(i.id, hours) })));

  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="📈" title={title} action={<span className="text-[11px] text-faint">{hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`}</span>} />
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
        {rows.length === 0 && <p className="text-sm text-muted">{d.widgets.noData}</p>}
        {rows.map((r) => (
          <div key={r.title} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm">{r.title}</span>
            <span
              className={`shrink-0 font-mono text-sm tabular-nums ${
                r.pct === null ? "text-faint" : r.pct >= 99 ? "text-ok" : r.pct >= 95 ? "text-warn" : "text-danger"
              }`}
            >
              {r.pct === null ? "—" : percent(r.pct, 2)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────── iCal ─────────────────────────────────

/** Upcoming events from any .ics calendar feed. */
async function IcalWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  const url = str(config.url);
  if (!url) {
    return (
      <Card className="h-full">
        <CardHeader icon="📅" title={title} />
        <p className="p-4 text-sm text-muted">{d.widgets.icalHint}</p>
      </Card>
    );
  }
  const events = await readIcal(url, num(config.limit, 8));
  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="📅" title={title} />
      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {!events || events.length === 0 ? (
          <p className="p-4 text-sm text-muted">{d.widgets.noData}</p>
        ) : (
          events.map((e, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-sm" title={e.summary}>
                {e.summary}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                {new Date(e.at).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                {!e.allDay && ` ${new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────── Air quality ─────────────────────────────

/** Air quality for a location, from Open-Meteo — no key, like the weather. */
async function AirQualityWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  const lat = Number(config.latitude);
  const lon = Number(config.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return (
      <Card className="h-full">
        <CardHeader icon="🌫️" title={title} />
        <p className="p-4 text-sm text-muted">{d.widgets.airHint}</p>
      </Card>
    );
  }

  let aqi: number | null = null;
  let pm25: number | null = null;
  let pm10: number | null = null;
  try {
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5,pm10`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const cur = (await res.json())?.current ?? {};
      aqi = num(cur.european_aqi, NaN);
      pm25 = num(cur.pm2_5, NaN);
      pm10 = num(cur.pm10, NaN);
    }
  } catch {
    // Degrades to "no data" like every other panel.
  }

  const band = aqiBand(aqi);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="🌫️" title={title} />
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
        {aqi === null || !Number.isFinite(aqi) ? (
          <p className="text-sm text-muted">{d.widgets.noData}</p>
        ) : (
          <>
            <p className={`font-mono text-4xl tabular-nums ${band.color}`}>{Math.round(aqi)}</p>
            <p className={`text-sm font-medium ${band.color}`}>{d.widgets[band.key as keyof typeof d.widgets]}</p>
            <p className="mt-1 font-mono text-[11px] text-faint">
              PM2.5 {pm25 != null && Number.isFinite(pm25) ? Math.round(pm25) : "—"} · PM10{" "}
              {pm10 != null && Number.isFinite(pm10) ? Math.round(pm10) : "—"}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

/** European AQI band → label key and colour. */
function aqiBand(aqi: number | null): { key: string; color: string } {
  if (aqi === null || !Number.isFinite(aqi)) return { key: "aqiUnknown", color: "text-faint" };
  if (aqi <= 20) return { key: "aqiGood", color: "text-ok" };
  if (aqi <= 40) return { key: "aqiFair", color: "text-ok" };
  if (aqi <= 60) return { key: "aqiModerate", color: "text-warn" };
  if (aqi <= 80) return { key: "aqiPoor", color: "text-warn" };
  return { key: "aqiVeryPoor", color: "text-danger" };
}

// ─────────────────────────────────── Rates ───────────────────────────────

/** Currency rates against a base, from a free no-key source. */
async function RatesWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  const base = (str(config.base) ?? "USD").toUpperCase();
  const symbols = lines(config.symbols).map((s) => s.toUpperCase());
  if (symbols.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader icon="💱" title={title} />
        <p className="p-4 text-sm text-muted">{d.widgets.ratesHint}</p>
      </Card>
    );
  }

  let rates: Record<string, number> = {};
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) rates = (await res.json())?.rates ?? {};
  } catch {
    // no data
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="💱" title={title} action={<span className="font-mono text-[11px] text-faint">{base}</span>} />
      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {Object.keys(rates).length === 0 ? (
          <p className="p-4 text-sm text-muted">{d.widgets.noData}</p>
        ) : (
          symbols.map((sym) => (
            <div key={sym} className="flex items-baseline justify-between gap-3 px-4 py-2">
              <span className="text-sm font-medium">{sym}</span>
              <span className="shrink-0 font-mono text-sm tabular-nums">
                {rates[sym] ? formatRate(rates[sym]) : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function formatRate(r: number): string {
  return r >= 100 ? r.toFixed(2) : r >= 1 ? r.toFixed(3) : r.toFixed(5);
}

// ──────────────────────────────── Shopping ───────────────────────────────

/** The shared shopping list — also fed by the Telegram bot. */
async function ShoppingWidget({ title, d, canControl }: { title: string; d: Dictionary; canControl: boolean }) {
  const items = await getShopping();
  return <ShoppingList d={d} title={title} items={items} canControl={canControl} />;
}

// ──────────────────────────────── Presence ───────────────────────────────

/** Who is home, from Home Assistant's people. */
async function PresenceWidget({ title, d }: { title: string; d: Dictionary }) {
  if (!(await haConfig())) {
    return <NotConfigured title={title} message={d.home.notConfigured} hint={d.home.notConfiguredHint} />;
  }
  const entities = await haStates();
  if (!entities) return <NotConfigured title={title} message={d.home.unreachable} hint={d.home.notConfiguredHint} />;

  const people = entities.filter((e) => e.domain === "person" || e.domain === "device_tracker");
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={title} icon="🏠" />
      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {people.length === 0 ? (
          <p className="p-4 text-sm text-muted">{d.widgets.noData}</p>
        ) : (
          people.map((p) => {
            const home = p.state === "home";
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${home ? "bg-ok" : "bg-faint"}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                <span className={`shrink-0 text-xs ${home ? "text-ok" : "text-muted"}`}>
                  {home ? d.widgets.presenceHome : p.state === "not_home" ? d.widgets.presenceAway : p.state}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────── Nutrition ───────────────────────────────

/** The personal food diary with КБЖУ targets, backed by FatSecret search. */
async function NutritionWidget({ title, d, canControl }: { title: string; d: Dictionary; canControl: boolean }) {
  const state = await getNutrition();
  return <NutritionDiary d={d} title={title} state={state} canControl={canControl} />;
}

// ─────────────────────────────── Internet ────────────────────────────────

/** The panel's own internet latency/speed watch. */
async function NetMonWidget({ title, d }: { title: string; d: Dictionary }) {
  const samples = await internetSamples();
  return <NetMonitor d={d} title={title} samples={samples} />;
}

// ──────────────────────────────── Agenda ─────────────────────────────────

/** Today at a glance: calendar events and reminders on one timeline, plus how
 *  the day's calories stand against the target. */
async function AgendaWidget({ title, d, userId }: { title: string; d: Dictionary; userId: string }) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const [reminders, eventsRaw, foodRows, profile] = await Promise.all([
    prisma.reminder.findMany({ where: { userId, done: false, at: { gte: start, lte: end } }, orderBy: { at: "asc" }, take: 12 }),
    upcomingEvents(userId, 2, 15),
    prisma.foodLog.findMany({ where: { userId, at: { gte: start } }, select: { kcal: true } }),
    getProfile(userId),
  ]);

  const time = (dt: Date) => dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  type Row = { at: number; time: string; icon: string; text: string };
  const rows: Row[] = [];
  for (const e of eventsRaw ?? []) {
    const dt = new Date(e.start);
    if (dt > end) continue; // only today
    rows.push({ at: e.allDay ? 0 : dt.getTime(), time: e.allDay ? d.widgets.agendaAllDay : time(dt), icon: "📅", text: e.summary || "—" });
  }
  for (const r of reminders) rows.push({ at: r.at.getTime(), time: time(r.at), icon: "⏰", text: r.title });
  rows.sort((a, b) => a.at - b.at);

  const kcal = Math.round(foodRows.reduce((s, f) => s + f.kcal, 0));
  const targetKcal = profile ? computeTargets(profile)?.kcal ?? null : null;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={title} icon="🗓️" />
      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {rows.length === 0 && <p className="p-4 text-sm text-muted">{d.widgets.agendaEmpty}</p>}
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-muted">{row.time}</span>
            <span aria-hidden>{row.icon}</span>
            <span className="min-w-0 flex-1 truncate">{row.text}</span>
          </div>
        ))}
      </div>
      {(kcal > 0 || targetKcal) && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs">
          <span className="text-muted">🍎 {d.widgets.nutritionKcal}</span>
          <span className="tabular-nums text-faint">
            {kcal}
            {targetKcal ? ` / ${targetKcal}` : ""}
          </span>
        </div>
      )}
    </Card>
  );
}

// ──────────────────────────────── Cameras ────────────────────────────────

/** Home Assistant camera snapshots, refreshed on a timer. */
async function CamerasWidget({ config, title, d }: { config: Record<string, unknown>; title: string; d: Dictionary }) {
  if (!(await haConfig())) {
    return <NotConfigured title={title} message={d.home.notConfigured} hint={d.home.notConfiguredHint} />;
  }
  const cameras = await haCameras(lines(config.entities));
  if (!cameras) return <NotConfigured title={title} message={d.home.unreachable} hint={d.home.notConfiguredHint} />;
  return <Cameras d={d} title={title} cameras={cameras} refreshSeconds={num(config.refreshSeconds, 10)} />;
}

// ──────────────────────────────── Habits ─────────────────────────────────

/** The personal daily habit checklist with streaks. */
async function HabitsWidget({ title, d, config, userId, canControl }: { title: string; d: Dictionary; config: Record<string, unknown>; userId: string; canControl: boolean }) {
  const habits = await habitsState(userId, lines(config.habits));
  return <Habits d={d} title={title} habits={habits} canControl={canControl} />;
}

// ─────────────────────────────────── WoL ─────────────────────────────────

/** Wake-on-LAN buttons for the machines the operator listed. */
function WolWidget({
  config,
  title,
  d,
  canControl,
}: {
  config: Record<string, unknown>;
  title: string;
  d: Dictionary;
  canControl: boolean;
}) {
  const machines: WolMachine[] = Array.isArray(config.machines)
    ? (config.machines as WolMachine[]).filter((m) => m && typeof m.mac === "string" && m.mac)
    : [];

  if (machines.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader icon="⏻" title={title} />
        <p className="p-4 text-sm text-muted">{d.widgets.wolHint}</p>
      </Card>
    );
  }
  return <Wol d={d} title={title} machines={machines} canControl={canControl} />;
}

function NotesWidget({ title, text }: { title: string; text: string }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon="📝" title={title} />
      {/* Markdown, lightly: headings, lists, task checkboxes, links. A note is
          a scratchpad, and plain text reads back as a wall. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-muted">
        <Markdown text={text} />
      </div>
    </Card>
  );
}
