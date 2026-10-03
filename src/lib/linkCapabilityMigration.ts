import type { PrismaClient } from "@prisma/client";
import { parseLinkCapabilities } from "./linkProtocol";
import { withinApprovedCapabilities } from "./linkCapabilityPolicy";

/** Recover a legacy device's approval from immutable pairing records, never from heartbeat state. */
export async function migrateLegacyLinkCapabilities(
  db: PrismaClient, deviceId: string, credentialHash: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const device = await tx.linkDevice.findFirst({
      where: { id: deviceId, credentialHash, revokedAt: null },
      select: { approvedCapabilities: true, capabilities: true },
    });
    if (!device) return false;
    if (device.approvedCapabilities !== null) return true;

    const pairings = await tx.linkPairing.findMany({
      where: { deviceId, status: { in: ["approved", "claimed"] } },
      select: { capabilities: true },
    });
    const manifests = new Set(pairings.map((pairing) => pairing.capabilities));
    if (manifests.size !== 1) return false;
    const baseline = [...manifests][0];
    try {
      if (!parseLinkCapabilities(JSON.parse(baseline))) return false;
    } catch {
      return false;
    }

    const current = parseStoredCapabilities(device.capabilities);
    const safeCurrent = current && withinApprovedCapabilities(baseline, current)
      ? device.capabilities : "[]";
    const updated = await tx.linkDevice.updateMany({
      where: { id: deviceId, credentialHash, revokedAt: null, approvedCapabilities: null },
      data: { approvedCapabilities: baseline, capabilities: safeCurrent },
    });
    return updated.count === 1;
  });
}

/** Reconcile selected offline recipients before deciding which can receive queued work. */
export async function reconcileLegacyLinkDevices(db: PrismaClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const candidates = await db.linkDevice.findMany({
    where: { id: { in: ids.slice(0, 100) }, revokedAt: null, approvedCapabilities: null },
    select: { id: true, credentialHash: true },
  });
  for (const candidate of candidates) {
    await migrateLegacyLinkCapabilities(db, candidate.id, candidate.credentialHash);
  }
}

function parseStoredCapabilities(value: string) {
  try {
    return parseLinkCapabilities(JSON.parse(value));
  } catch {
    return null;
  }
}
