import "server-only";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";

const JOB_PREFIX = "link.device-file-cleanup.";

/** Only randomized temporary file locations survive until filesystem cleanup succeeds. */
export async function drainDeviceFileCleanup() {
  const jobs = await prisma.setting.findMany({ where: { key: { startsWith: JOB_PREFIX } }, take: 50 });
  for (const job of jobs) {
    const paths: unknown = JSON.parse(job.value);
    if (!Array.isArray(paths) || paths.some(p => typeof p !== "string" || !/^(link-upload-sessions\/[A-Za-z0-9_-]{1,40}|link-transfers\/[a-f0-9]{48})$/.test(p))) throw new Error("Invalid device file cleanup job");
    const root = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR?.trim() || "/data");
    for (const relative of paths as string[]) await rm(path.join(/* turbopackIgnore: true */ root, relative), { force: true, recursive: relative.startsWith("link-upload-sessions/") });
    await prisma.setting.deleteMany({ where: { key: job.key, value: job.value } });
  }
}

export async function purgeRevokedLinkDevices(ids?: string[]) {
  const rows = await prisma.linkDevice.findMany({ where: { revokedAt: { not: null }, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true }, take: 50 });
  let removed = 0;
  for (const row of rows) {
    removed += await prisma.$transaction(async tx => {
      const pairings = await tx.linkPairing.findMany({ where: { deviceId: row.id }, select: { id: true } });
      // Conditional deletion prevents a concurrent re-pair from deleting a live binding.
      const claimed = await tx.linkDevice.deleteMany({ where: { id: row.id, revokedAt: { not: null } } });
      if (!claimed.count) return 0;
      const deviceMatch = { OR: [{ sourceDeviceId: row.id }, { targetDeviceId: row.id }] };
      const transfers = await tx.linkFileTransfer.findMany({ where: deviceMatch, select: { id: true, storageName: true } });
      const batches = await tx.linkShareBatch.findMany({ where: deviceMatch, select: { id: true } });
      const uploads = await tx.linkUploadSession.findMany({ where: deviceMatch, select: { id: true } });
      const transferIds = new Set(transfers.map(t => t.id));
      const batchIds = new Set(batches.map(b => b.id));
      const offers = await tx.linkDeviceEvent.findMany({ where: { kind: "share.offer" }, select: { id: true, payload: true } });
      const obsolete = offers.filter(offer => {
        try { const payload = JSON.parse(offer.payload); return transferIds.has(payload.transferId) || batchIds.has(payload.batchId) || payload.sourceDeviceId === row.id; } catch { return false; }
      });
      await tx.linkDeviceEvent.deleteMany({ where: { OR: [{ deviceId: row.id }, { id: { in: obsolete.map(e => e.id) } }] } });
      await tx.linkPairing.deleteMany({ where: { id: { in: pairings.map(p => p.id) } } });
      await tx.linkCommand.deleteMany({ where: { deviceId: row.id } });
      await tx.linkUploadSession.deleteMany({ where: deviceMatch });
      await tx.linkShareBatch.deleteMany({ where: deviceMatch });
      await tx.linkFileTransfer.deleteMany({ where: deviceMatch });
      const paths = [...uploads.map(u => `link-upload-sessions/${u.id}`), ...transfers.map(t => `link-transfers/${t.storageName}`)];
      if (paths.length) await tx.setting.create({ data: { key: `${JOB_PREFIX}${randomUUID()}`, value: JSON.stringify(paths) } });
      return 1;
    });
  }
  await drainDeviceFileCleanup();
  return removed;
}

const state = globalThis as typeof globalThis & { homeplaceDeviceCleanupTimer?: ReturnType<typeof setInterval>; homeplaceDeviceCleanupRunning?: boolean };
export async function startDeviceCleanup() {
  if (state.homeplaceDeviceCleanupTimer) return;
  const run = async () => {
    if (state.homeplaceDeviceCleanupRunning) return;
    state.homeplaceDeviceCleanupRunning = true;
    try { await purgeRevokedLinkDevices(); } catch (error) { console.error("Deleted device cleanup failed:", error); }
    finally { state.homeplaceDeviceCleanupRunning = false; }
  };
  await run();
  state.homeplaceDeviceCleanupTimer = setInterval(() => void run(), 5 * 60_000);
  state.homeplaceDeviceCleanupTimer.unref();
}
