import "server-only";
import { prisma, getSetting, setSetting } from "./db";
import { listContainers } from "./docker";
import { resolvedDockerHosts } from "./integrations";
import { notify } from "./notify";
import {
  dockerUptimeSeconds,
  nextContainerIncident,
  observedRestart,
  type ContainerIncidentState,
  type ContainerUptimeSnapshot,
} from "./containerIncident";

const CHECK_INTERVAL_MS = 60_000;
let nextCheckAt = 0;
let running = false;

/** Monitor Docker's state and health verdict without an inspect call per container. */
export async function checkContainerHealthDue(): Promise<void> {
  if (running || Date.now() < nextCheckAt) return;
  nextCheckAt = Date.now() + CHECK_INTERVAL_MS;
  running = true;
  try {
    if ((await resolvedDockerHosts()).length === 0) return;
    const [containers, previousUptimes] = await Promise.all([
      listContainers(),
      getSetting<Record<string, ContainerUptimeSnapshot> | null>("monitor.containerUptime", null),
    ]);
    const uptimes = previousUptimes ?? {};
    const nextUptimes: Record<string, ContainerUptimeSnapshot> = {};
    const keys = containers.map((container) => `container-health:${container.hostKey}/${container.name}`);
    const states = await prisma.alertState.findMany({ where: { itemId: { in: keys } } });
    const byKey = new Map(states.map((state) => [state.itemId, state]));
    const now = new Date();

    for (const container of containers) {
      const key = `container-health:${container.hostKey}/${container.name}`;
      const uptime: ContainerUptimeSnapshot = {
        id: container.id,
        seconds: dockerUptimeSeconds(container.status),
        at: now.getTime(),
      };
      if (container.state === "running") nextUptimes[key] = uptime;
      const previous = byKey.get(key);
      // A container already stopped at first sight may be a deliberate one-shot job.
      if (!previous && container.state !== "running" && container.state !== "restarting") continue;

      const oldState: ContainerIncidentState | null = previous
        ? {
            state: previous.state as ContainerIncidentState["state"],
            since: previous.since,
            notifiedAt: previous.notifiedAt,
          }
        : null;
      const problem = container.state !== "running" || container.health === "unhealthy";
      const transition = nextContainerIncident(oldState, problem, container.state === "restarting", now);
      const eventKind = transition.event ?? (
        !problem && oldState?.state === "up" && observedRestart(uptimes[key], uptime) ? "restart" : undefined
      );

      if (transition.changed) {
        await prisma.alertState.upsert({
          where: { itemId: key },
          update: transition.state,
          create: { itemId: key, ...transition.state },
        });
      }

      let eventId: string | undefined;
      if (eventKind) {
        const reason = container.health === "unhealthy" ? "Docker health check is unhealthy" : `Docker state: ${container.state}`;
        const event = await prisma.event.create({
          data: {
            type: "container",
            severity: eventKind === "down" ? "error" : "info",
            title: `${container.name}: ${eventKind === "down" ? "unavailable" : eventKind === "up" ? "recovered" : "restarted"}`,
            detail: `${container.hostLabel} · ${reason}`,
          },
        });
        eventId = event.id;
      }

      if (transition.state.state === "down" && !transition.state.notifiedAt) {
        const delivered = await notify({
          title: `${container.name} is unavailable`,
          body: `${container.hostLabel}: ${container.health === "unhealthy" ? "health check failed" : container.status}`,
          type: "container",
          severity: "error",
          tag: key,
          url: eventId ? `/events?event=${encodeURIComponent(eventId)}` : "/events?type=container",
          respectQuietHours: false,
          urgent: true,
        });
        if (wasDelivered(delivered)) {
          await prisma.alertState.update({ where: { itemId: key }, data: { notifiedAt: now } });
        }
      } else if (eventKind === "up" && oldState?.notifiedAt) {
        await notify({
          title: `${container.name} recovered`,
          body: `${container.hostLabel}: running again`,
          type: "container",
          severity: "info",
          tag: key,
          url: `/events?event=${encodeURIComponent(eventId!)}`,
        });
      } else if (eventKind === "restart") {
        await notify({
          title: `${container.name} restarted`,
          body: `${container.hostLabel}: Docker reported a restart`,
          type: "container",
          severity: "info",
          tag: key,
          url: `/events?event=${encodeURIComponent(eventId!)}`,
        });
      }
    }
    if (containers.length > 0) await setSetting("monitor.containerUptime", nextUptimes);
  } catch (error) {
    console.error("container health check failed:", error);
  } finally {
    running = false;
  }
}

function wasDelivered(result: Awaited<ReturnType<typeof notify>>): boolean {
  return result.suppressed || result.push > 0 || result.link > 0 || result.telegram || result.ntfy || result.webhook || result.email;
}
