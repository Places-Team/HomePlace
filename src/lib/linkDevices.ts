import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { prisma } from "./db";
import { decrypt, encrypt } from "./secretBox";
import type { LinkCapability, LinkPairRequest } from "./linkProtocol";
import { LINK_PROTOCOL_MAX } from "./linkProtocol";
import { linkServerId } from "./linkServer";
import { secretsEqual } from "./security";
import { discardFileTransfer, pruneExpiredFileTransfers } from "./linkFiles";

const PAIRING_LIFETIME_MS = 5 * 60_000;
const MAX_PENDING_EVENTS = 50;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");

export async function createLinkPairing(input: LinkPairRequest) {
  const claimSecret = secret();
  const expiresAt = new Date(Date.now() + PAIRING_LIFETIME_MS);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    try {
      const pairing = await prisma.linkPairing.create({
        data: {
          code,
          claimSecretHash: digest(claimSecret),
          name: input.device.name,
          platform: input.device.platform,
          platformVersion: input.device.platformVersion,
          appVersion: input.device.appVersion,
          publicKey: input.publicKey,
          capabilities: JSON.stringify(input.capabilities),
          permissions: JSON.stringify(input.permissions),
          expiresAt,
        },
      });
      return { id: pairing.id, code, claimSecret, expiresAt: expiresAt.toISOString(), pollAfterSeconds: 2 };
    } catch (error) {
      if (!isUniqueConstraint(error) || attempt === 4) throw error;
    }
  }
  throw new Error("could not allocate pairing code");
}

export async function claimLinkPairing(id: string, claimSecret: string) {
  const pairing = await prisma.linkPairing.findUnique({ where: { id } });
  if (!pairing || !secretsEqual(pairing.claimSecretHash, digest(claimSecret))) return null;
  if (pairing.expiresAt.getTime() <= Date.now() && (pairing.status === "pending" || pairing.status === "approved")) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.linkPairing.updateMany({
        where: { id, status: { in: ["pending", "approved"] } },
        data: { status: "expired", code: null, encryptedCredential: null },
      });
      if (pairing.deviceId) {
        await tx.linkDevice.updateMany({
          where: { id: pairing.deviceId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
    });
    return { status: "expired" as const };
  }
  if (pairing.status !== "approved" || !pairing.deviceId || !pairing.encryptedCredential) {
    return { status: pairing.status as "pending" | "rejected" | "expired" | "claimed" };
  }
  const credential = await decrypt(pairing.encryptedCredential);
  if (!credential) return { status: "expired" as const };
  const claimed = await prisma.linkPairing.updateMany({
    where: { id, status: "approved", encryptedCredential: pairing.encryptedCredential },
    data: { status: "claimed", code: null, claimedAt: new Date(), encryptedCredential: null },
  });
  if (claimed.count !== 1) return { status: "claimed" as const };
  return {
    status: "approved" as const,
    serverId: await linkServerId(),
    deviceId: pairing.deviceId,
    credential,
  };
}

export async function approveLinkPairing(id: string, userId: string) {
  const pairing = await prisma.linkPairing.findUnique({ where: { id } });
  if (!pairing || pairing.status !== "pending" || pairing.expiresAt.getTime() <= Date.now()) return false;
  const credential = secret();
  const encryptedCredential = await encrypt(credential);
  return prisma.$transaction(async (tx) => {
    const reserved = await tx.linkPairing.updateMany({
      where: { id, status: "pending", expiresAt: { gt: new Date() } },
      data: { status: "approving" },
    });
    if (reserved.count !== 1) return false;
    const previous = await tx.linkDevice.findMany({
      where: { userId, publicKey: pairing.publicKey },
      select: { id: true, revokedAt: true, lastSeenAt: true, updatedAt: true },
      orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }],
    });
    const deviceData = {
      name: pairing.name,
      platform: pairing.platform,
      platformVersion: pairing.platformVersion,
      appVersion: pairing.appVersion,
      publicKey: pairing.publicKey,
      credentialHash: digest(credential),
      capabilities: pairing.capabilities,
      permissions: pairing.permissions,
      userId,
      revokedAt: null,
      lastSeenAt: null,
    };
    const canonical = previous.find((item) => item.revokedAt === null) ?? previous[0];
    const device = canonical
      ? await tx.linkDevice.update({ where: { id: canonical.id }, data: deviceData })
      : await tx.linkDevice.create({ data: deviceData });
    const duplicateIds = previous.filter((item) => item.id !== device.id).map((item) => item.id);
    if (duplicateIds.length > 0) {
      await tx.linkDevice.updateMany({
        where: { id: { in: duplicateIds } },
        data: { revokedAt: new Date() },
      });
    }
    await tx.linkPairing.update({
      where: { id },
      data: {
        status: "approved",
        approvedById: userId,
        deviceId: device.id,
        encryptedCredential,
        code: null,
      },
    });
    return true;
  });
}

export async function rejectLinkPairing(id: string) {
  const result = await prisma.linkPairing.updateMany({
    where: { id, status: "pending" },
    data: { status: "rejected", code: null },
  });
  return result.count > 0;
}

export async function authenticateLinkDevice(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return null;
  return prisma.linkDevice.findFirst({ where: { credentialHash: digest(token), revokedAt: null } });
}

export function linkDeviceHasPermission(device: { permissions: string }, permission: string): boolean {
  try {
    const permissions = JSON.parse(device.permissions) as unknown;
    return Array.isArray(permissions) && permissions.includes(permission);
  } catch {
    return false;
  }
}

export function linkDeviceHasCapability(device: { capabilities: string }, capability: string): boolean {
  return parsedCapabilities(device.capabilities).has(capability);
}

export async function heartbeatLinkDevice(deviceId: string, acknowledgedEventIds: string[], capabilities?: LinkCapability[]) {
  await pruneExpiredFileTransfers();
  const now = new Date();
  const ephemeralCutoff = new Date(now.getTime() - 5 * 60_000);
  const declinedTransfers = acknowledgedEventIds.length ? await prisma.linkDeviceEvent.findMany({
    where: { deviceId, id: { in: acknowledgedEventIds }, kind: "share.offer" },
    select: { payload: true },
  }) : [];
  const events = await prisma.$transaction(async (tx) => {
    await tx.linkDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: now, ...(capabilities ? { capabilities: JSON.stringify(capabilities) } : {}) },
    });
    await tx.linkDeviceEvent.deleteMany({
      where: { deviceId, kind: { in: ["clipboard.offer", "share.offer"] }, createdAt: { lt: ephemeralCutoff } },
    });
    if (acknowledgedEventIds.length) {
      await tx.linkDeviceEvent.deleteMany({
        where: { deviceId, id: { in: acknowledgedEventIds }, kind: { in: ["clipboard.offer", "share.offer"] } },
      });
      await tx.linkDeviceEvent.updateMany({
        where: { deviceId, id: { in: acknowledgedEventIds }, kind: { notIn: ["clipboard.offer", "share.offer"] }, deliveredAt: null },
        data: { deliveredAt: now },
      });
    }
    const queued = await tx.linkDeviceEvent.findMany({
      where: { deviceId, deliveredAt: null },
      orderBy: { createdAt: "asc" },
      take: MAX_PENDING_EVENTS,
    });
    return queued;
  });
  await Promise.all(declinedTransfers.flatMap((event) => {
    try {
      const payload = JSON.parse(event.payload) as { transferId?: unknown };
      return typeof payload.transferId === "string" ? [discardFileTransfer(payload.transferId, deviceId)] : [];
    } catch {
      return [];
    }
  }));
  return {
    protocol: LINK_PROTOCOL_MAX,
    serverId: await linkServerId(),
    serverTime: now.toISOString(),
    events: events.map((event) => ({
      protocol: LINK_PROTOCOL_MAX,
      id: event.id,
      type: event.kind,
      deviceId,
      sentAt: event.createdAt.toISOString(),
      payload: JSON.parse(event.payload) as unknown,
    })),
  };
}

export async function revokeLinkDevice(deviceId: string) {
  const result = await prisma.linkDevice.updateMany({
    where: { id: deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function queueTestNotification(deviceId: string) {
  const device = await prisma.linkDevice.findFirst({ where: { id: deviceId, revokedAt: null } });
  if (!device) return false;
  const capabilities = JSON.parse(device.capabilities) as { name?: string }[];
  if (!capabilities.some((capability) => capability.name === "notification.receive")) return false;
  await prisma.linkDeviceEvent.create({
    data: {
      deviceId,
      kind: "notification.deliver",
      payload: JSON.stringify({ title: "HomePlace", body: "Test notification — connection is working." }),
    },
  });
  return true;
}

/** Queue an alert for every paired, capable device owned by these users. */
export async function queueLinkNotifications(
  userIds: string[],
  message: { title: string; body: string; tag?: string },
): Promise<number> {
  if (userIds.length === 0) return 0;
  const devices = await prisma.linkDevice.findMany({
    where: { userId: { in: userIds }, revokedAt: null },
    select: { id: true, capabilities: true },
  });
  const capable = devices.filter((device) => parsedCapabilities(device.capabilities).has("notification.receive"));
  let queued = 0;
  for (const device of capable) {
    const pending = await prisma.linkDeviceEvent.count({
      where: { deviceId: device.id, kind: "notification.deliver", deliveredAt: null },
    });
    if (pending >= MAX_PENDING_EVENTS) continue;
    await prisma.linkDeviceEvent.create({
      data: {
        deviceId: device.id,
        kind: "notification.deliver",
        payload: JSON.stringify(message),
      },
    });
    queued += 1;
  }
  return queued;
}

/** Relay clipboard text only to the same user's explicitly capable devices. */
export async function relayClipboard(source: { id: string; userId: string | null; name: string }, text: string) {
  if (!source.userId) return 0;
  const devices = await prisma.linkDevice.findMany({
    where: { userId: source.userId, id: { not: source.id }, revokedAt: null },
    select: { id: true, capabilities: true },
  });
  const targets = devices.filter((device) => {
    try {
      const capabilities = JSON.parse(device.capabilities) as { name?: string }[];
      return capabilities.some((capability) => capability.name === "clipboard.receive");
    } catch {
      return false;
    }
  });
  if (targets.length === 0) return 0;
  await prisma.$transaction(targets.map((device) => prisma.linkDeviceEvent.create({
    data: {
      deviceId: device.id,
      kind: "clipboard.offer",
      payload: JSON.stringify({ text, sourceName: source.name }),
    },
  })));
  return targets.length;
}

export async function shareTargets(source: { id: string; userId: string | null }) {
  if (!source.userId) return [];
  const devices = await prisma.linkDevice.findMany({
    where: {
      id: { not: source.id },
      revokedAt: null,
      OR: [{ userId: source.userId }, { allowHouseholdShares: true }],
    },
    select: {
      id: true,
      name: true,
      platform: true,
      capabilities: true,
      lastSeenAt: true,
      userId: true,
      user: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  return devices.flatMap((device) => {
    const capabilities = parsedCapabilities(device.capabilities);
    const supportsText = capabilities.has("text.receive");
    const supportsUrl = capabilities.has("url.open");
    const supportsFile = capabilities.has("file.receive");
    if (!supportsText && !supportsUrl && !supportsFile) return [];
    return [{
      id: device.id,
      name: device.name,
      platform: device.platform,
      supportsText,
      supportsUrl,
      supportsFile,
      online: device.lastSeenAt !== null && device.lastSeenAt.getTime() > Date.now() - 90_000,
      ownerName: device.user?.name ?? "HomePlace user",
      ownedByCurrentUser: device.userId === source.userId,
    }];
  });
}

export async function resolveShareTarget(
  source: { id: string; userId: string | null; capabilities: string },
  targetDeviceId: string,
  type: "text" | "url" | "file",
) {
  if (!source.userId || !parsedCapabilities(source.capabilities).has("share.send")) return null;
  const target = await prisma.linkDevice.findFirst({
    where: {
      id: targetDeviceId,
      NOT: { id: source.id },
      revokedAt: null,
      OR: [{ userId: source.userId }, { allowHouseholdShares: true }],
    },
    select: { id: true, capabilities: true },
  });
  if (!target) return null;
  const required = type === "text" ? "text.receive" : type === "url" ? "url.open" : "file.receive";
  return parsedCapabilities(target.capabilities).has(required) ? target : null;
}

export async function setHouseholdSharing(deviceId: string, enabled: boolean) {
  const result = await prisma.linkDevice.updateMany({
    where: { id: deviceId, revokedAt: null },
    data: { allowHouseholdShares: enabled },
  });
  return result.count > 0;
}

export async function setLinkDevicePermission(
  deviceId: string,
  permission: "share.relay",
  enabled: boolean,
) {
  const device = await prisma.linkDevice.findFirst({
    where: { id: deviceId, revokedAt: null },
    select: { permissions: true },
  });
  if (!device) return false;
  let current: string[] = [];
  try {
    const parsed = JSON.parse(device.permissions) as unknown;
    if (Array.isArray(parsed)) current = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    current = [];
  }
  const permissions = new Set(current);
  if (enabled) permissions.add(permission);
  else permissions.delete(permission);
  await prisma.linkDevice.update({
    where: { id: deviceId },
    data: { permissions: JSON.stringify([...permissions].sort()) },
  });
  return true;
}

export async function queueShareOffer(
  targetDeviceId: string,
  payload: Record<string, string | number>,
) {
  await prisma.linkDeviceEvent.deleteMany({
    where: { deviceId: targetDeviceId, kind: "share.offer", createdAt: { lt: new Date(Date.now() - 5 * 60_000) } },
  });
  const pending = await prisma.linkDeviceEvent.count({
    where: { deviceId: targetDeviceId, kind: "share.offer", deliveredAt: null },
  });
  if (pending >= 20) return false;
  await prisma.linkDeviceEvent.create({
    data: { deviceId: targetDeviceId, kind: "share.offer", payload: JSON.stringify(payload) },
  });
  return true;
}

export async function queueDashboardShare(
  targetDeviceId: string,
  type: "text" | "url",
  value: string,
): Promise<"queued" | "unavailable" | "unsupported" | "full"> {
  const target = await prisma.linkDevice.findFirst({
    where: { id: targetDeviceId, revokedAt: null },
    select: { id: true, capabilities: true },
  });
  if (!target) return "unavailable";
  const required = type === "url" ? "url.open" : "text.receive";
  if (!parsedCapabilities(target.capabilities).has(required)) return "unsupported";
  const queued = await queueShareOffer(target.id, {
    type,
    value,
    sourceName: "HomePlace",
  });
  return queued ? "queued" : "full";
}

function parsedCapabilities(value: string): Set<string> {
  try {
    const capabilities = JSON.parse(value) as { name?: unknown }[];
    return new Set(capabilities.flatMap((item) => typeof item.name === "string" ? [item.name] : []));
  } catch {
    return new Set();
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002";
}
