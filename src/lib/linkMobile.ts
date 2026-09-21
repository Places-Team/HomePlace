import "server-only";
import { prisma } from "./db";
import { authenticateLinkDevice, linkDeviceHasPermission } from "./linkDevices";
import { groupRecentEvents } from "./eventGroups";
import { listContainers } from "./docker";
import { mobileContainerSummary } from "./linkMonitoring";

export type MobilePermission = "dashboard.read" | "calendar.read" | "calendar.manage" | "reminder.manage" | "media.request" | "telegram.send" | "clipboard.relay" | "share.relay";

export type MobileAuthorization =
  | { ok: true; device: Awaited<ReturnType<typeof authenticateLinkDevice>> & { userId: string } }
  | { ok: false; status: 401 | 403; error: string };

/** Authenticate one approved device and enforce the permission shown at pairing. */
export async function authorizeMobile(request: Request, permission: MobilePermission): Promise<MobileAuthorization> {
  const device = await authenticateLinkDevice(request);
  if (!device) return { ok: false, status: 401, error: "invalid device credential" };
  if (!device.userId) return { ok: false, status: 403, error: "device is not linked to a user" };
  if (!linkDeviceHasPermission(device, permission)) return { ok: false, status: 403, error: "device permission is not granted" };
  return { ok: true, device: { ...device, userId: device.userId } };
}

export async function monitoringSummary() {
  const [items, recent, containers] = await Promise.all([
    prisma.item.findMany({
      where: { checkKind: { not: "none" } },
      select: {
        id: true,
        title: true,
        checks: { orderBy: { at: "desc" }, take: 1, select: { ok: true, latency: true, at: true } },
      },
      orderBy: { title: "asc" },
      take: 100,
    }),
    prisma.event.findMany({
      orderBy: { at: "desc" },
      take: 32,
      select: { id: true, type: true, severity: true, title: true, detail: true, itemId: true, actor: true, at: true },
    }),
    listContainers(),
  ]);
  const services = items.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.checks[0] ? (item.checks[0].ok ? "online" : "offline") : "unknown",
    latencyMs: item.checks[0]?.latency ?? null,
    checkedAt: item.checks[0]?.at.toISOString() ?? null,
  }));
  return {
    total: services.length,
    online: services.filter((item) => item.status === "online").length,
    offline: services.filter((item) => item.status === "offline").length,
    unknown: services.filter((item) => item.status === "unknown").length,
    services,
    containers: mobileContainerSummary(containers),
    recent: groupRecentEvents(recent).slice(0, 8).map((event) => ({
      id: event.id,
      type: event.type,
      severity: event.severity,
      title: event.title,
      detail: event.detail,
      at: event.at.toISOString(),
      count: event.count,
    })),
  };
}
