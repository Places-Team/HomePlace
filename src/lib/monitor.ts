import "server-only";
import { prisma } from "./db";
import { settings } from "./config";
import { listContainers } from "./docker";
import { processAlerts } from "./alerts";
import { evaluateRules } from "./rules";
import { processReminders } from "./reminders";
import { runDueSchedules } from "./schedules";
import { startTelegramPolling } from "./telegramBot";
import { sampleContainersToDb, pruneMetrics } from "./metricStore";
import { prometheusConfig } from "./integrations";
import { checkSmartDrift } from "./smart";
import { probeInternet } from "./netmon";
import { checkContainerUpdatesDue } from "./imageUpdates";
import { checkTelegramBotsDue } from "./telegramHealth";
import { isDue } from "./cadence";

/**
 * The availability prober.
 *
 * This is the one piece of history HomePlace keeps for itself. Prometheus knows
 * far more about metrics, but "is this service answering right now, and was it
 * answering last night" has to work on a fresh install with nothing else set
 * up — otherwise the dashboard has no status dots on day one.
 *
 * It runs in-process on a timer. A dashboard for one household does not need a
 * job queue, and a single interval is something you can reason about at 2am.
 */

const TICK_MS = 10_000;
const MAINTENANCE_MS = 3_600_000;
let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRuleEval = 0;
let lastMaintenance = 0;

/**
 * Started from the first server render rather than from an instrumentation
 * hook.
 *
 * The hook version gets compiled for the edge runtime as well, which drags
 * everything it can reach — Prisma, node:crypto, the HTTP stack — into a bundle
 * that cannot contain them. Starting from a server component keeps the whole
 * chain in the Node runtime where it belongs, and the module-level `timer`
 * guard makes the call idempotent however many pages render.
 */
export function startMonitor(): void {
  // The Telegram command bot has its own long-polling loop and is independent of
  // the probe monitor — start it even if uptime monitoring is switched off.
  startTelegramPolling();
  if (timer || !settings.monitorEnabled()) return;
  // A first pass shortly after boot, so the dashboard is not blank on arrival.
  setTimeout(() => void tick(), 3000);
  timer = setInterval(() => void tick(), TICK_MS);
  console.log("uptime monitor started");
}

async function tick(): Promise<void> {
  // Ticks must never overlap: a slow probe round would otherwise pile up
  // requests against a service that is already struggling.
  if (running) return;
  running = true;
  try {
    await probeDue();
    // Metric rules run against Prometheus; every 30s is plenty (a breach still
    // surfaces well within its hold time) and a third of the query load of the
    // 10-second tick.
    if (Date.now() - lastRuleEval > 30_000) {
      lastRuleEval = Date.now();
      await evaluateRules();
    }
    await processReminders();
    await runDueSchedules();
    // Watch the disks' failing-sector counters for any worsening. Self-throttled
    // to once an hour, so riding the tick costs nothing most of the time.
    await checkSmartDrift().catch((e) => console.error("smart check failed:", e));
    // Internet latency/speed watch — self-throttled, and only runs at all when
    // an internet-monitor widget is on a board.
    await probeInternet().catch((e) => console.error("internet probe failed:", e));
    // Once a day, ask each container's registry whether a newer image exists, so
    // the update badges are there on arrival rather than only after a click.
    await checkContainerUpdatesDue().catch((e) => console.error("update check failed:", e));
    // Bot identity and webhook health are independent from Telegram being a
    // notification route: a broken Telegram bot must still alert Link devices.
    await checkTelegramBotsDue();
    // The Telegram bot runs its own long-polling loop (startTelegramPolling) so
    // replies are instant rather than up to a tick late — it is not driven from
    // here any more.
    // Container CPU/memory history is only sampled when there is no Prometheus
    // to provide it — otherwise this fired a stats call per container every few
    // seconds for nothing, which was most of the panel's own CPU. Prometheus
    // installs read their history straight from Prometheus.
    if (!(await prometheusConfig())) {
      await sampleContainersToDb();
    }
    if (isDue(lastMaintenance, MAINTENANCE_MS)) {
      lastMaintenance = Date.now();
      await pruneOldChecks();
      await pruneMetrics();
    }
  } catch (e) {
    console.error("monitor tick failed:", e);
  } finally {
    running = false;
  }
}

type ProbeResult = { ok: boolean; latency?: number; status?: number; error?: string };

async function probeDue(): Promise<void> {
  const items = await prisma.item.findMany({
    where: { checkKind: { not: "none" } },
    include: { checks: { orderBy: { at: "desc" }, take: 1 } },
  });
  if (items.length === 0) return;

  // Everything watched, seeded with what was already known. Tiles that are not
  // due this tick still take part in alerting: an outage does not pause because
  // the check interval is five minutes.
  const latest = new Map<string, { id: string; title: string; ok: boolean; error: string | null }>();
  for (const item of items) {
    const last = item.checks[0];
    if (last) latest.set(item.id, { id: item.id, title: item.title, ok: last.ok, error: last.error });
  }

  const now = Date.now();
  const due = items.filter((item) => {
    const last = item.checks[0];
    const interval = Math.max(settings.minCheckInterval(), item.checkInterval) * 1000;
    return !last || now - last.at.getTime() >= interval;
  });

  // Query Docker only when a Docker-backed item is actually due. Previously
  // this listed every container every ten seconds even with minutes left.
  const needContainers = due.some((item) => item.checkKind === "docker");
  const containers = needContainers ? await listContainers() : [];

  await Promise.all(
    due.map(async (item) => {
      const previous = item.checks[0]?.ok ?? null;
      const result =
        item.checkKind === "docker"
          ? probeContainer(item.containerName, item.hostKey, containers)
          : await probeHttp(item.checkUrl || item.internalUrl || item.url);

      await prisma.uptimeCheck.create({
        data: {
          itemId: item.id,
          ok: result.ok,
          latency: result.latency ?? null,
          status: result.status ?? null,
          error: result.error?.slice(0, 300) ?? null,
        },
      });

      latest.set(item.id, { id: item.id, title: item.title, ok: result.ok, error: result.error ?? null });

      // Only transitions become events. Writing one row per probe would bury
      // the feed under thousands of "still fine" entries.
      if (previous !== null && previous !== result.ok) {
        await prisma.event.create({
          data: {
            itemId: item.id,
            type: result.ok ? "up" : "down",
            severity: result.ok ? "info" : "error",
            title: item.title,
            detail: result.ok ? null : result.error?.slice(0, 300) ?? null,
          },
        });
      }
    })
  );

  // Notifications come last and never take the probe loop down with them: a
  // Telegram outage must not stop the panel from knowing its own state.
  try {
    await processAlerts([...latest.values()]);
  } catch (e) {
    console.error("alert processing failed:", e);
  }
}

async function probeHttp(url: string | null | undefined): Promise<ProbeResult> {
  if (!url) return { ok: false, error: "no address to check" };
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "HomePlace/monitor" },
    });
    // Anything that answers is up. A login page returning 401, or a redirect to
    // one, still proves the service is alive — which is what the dot means.
    const ok = res.status < 500;
    return { ok, latency: Date.now() - started, status: res.status };
  } catch (e) {
    return { ok: false, latency: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

function probeContainer(
  name: string | null,
  hostKey: string | null,
  containers: Awaited<ReturnType<typeof listContainers>>
): ProbeResult {
  if (!name) return { ok: false, error: "no container attached" };
  const found = containers.find((c) => c.name === name && (!hostKey || c.hostKey === hostKey));
  if (!found) return { ok: false, error: "container not found" };
  return { ok: found.state === "running", error: found.state === "running" ? undefined : found.status };
}

/** Keep the uptime table a rolling window; events are kept longer and separately. */
async function pruneOldChecks(): Promise<void> {
  const cutoff = new Date(Date.now() - settings.uptimeRetentionDays() * 86400_000);
  await prisma.uptimeCheck.deleteMany({ where: { at: { lt: cutoff } } });
  // Events are cheap but not infinite: a year is plenty for a home panel.
  await prisma.event.deleteMany({ where: { at: { lt: new Date(Date.now() - 365 * 86400_000) } } });
}

/** Availability over a window, for the tile footer. Null when never checked. */
export async function uptimeRatio(itemId: string, hours: number): Promise<number | null> {
  const since = new Date(Date.now() - hours * 3600_000);
  const [total, ok] = await Promise.all([
    prisma.uptimeCheck.count({ where: { itemId, at: { gte: since } } }),
    prisma.uptimeCheck.count({ where: { itemId, at: { gte: since }, ok: true } }),
  ]);
  if (total === 0) return null;
  return (ok / total) * 100;
}
