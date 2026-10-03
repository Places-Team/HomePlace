import "server-only";
import { prisma } from "./db";
import { resolveShareTarget } from "./linkDevices";
import { configuredFileLimit } from "./fileUploadPolicy";
import { parseBatchManifest, batchProgress } from "./linkBatchPolicy";
import { activeApprovedCapabilities } from "./linkCapabilityPolicy";
import { discardFileTransfer } from "./linkFiles";

type Device = { id: string; userId: string | null; capabilities: string; approvedCapabilities: string | null; name: string };
const TTL = 24 * 60 * 60_000;

async function releaseBatchFiles(id: string, targetDeviceId: string) {
  const files = await prisma.linkFileTransfer.findMany({ where: { batchId: id, targetDeviceId }, select: { id: true } });
  for (const file of files) await discardFileTransfer(file.id, targetDeviceId);
  const slots = await prisma.linkBatchFile.findMany({ where: { batchId: id }, select: { id: true } });
  await prisma.linkUploadSession.updateMany({ where: { batchFileId: { in: slots.map(f => f.id) } }, data: { expiresAt: new Date() } });
  const { pruneUploadSessions } = await import("./linkResumableUploads");
  await pruneUploadSessions();
}

export async function createBatch(source: Device, targetId: string, manifest: unknown, requestKey?: string) {
  const files = parseBatchManifest(manifest, configuredFileLimit());
  if (!files || !await resolveShareTarget(source, targetId, "file")) return null;
  const receiver = await prisma.linkDevice.findUnique({ where: { id: targetId } });
  try {
    if (!receiver || !activeApprovedCapabilities(receiver.capabilities, receiver.approvedCapabilities).has("file.batch.receive") || !JSON.parse(receiver.permissions).includes("share.relay")) return null;
  } catch { return null; }
  const now = new Date();
  await prisma.linkShareBatch.deleteMany({ where: { expiresAt: { lte: now } } });
  if (requestKey) {
    const old = await prisma.linkShareBatch.findFirst({ where: { sourceDeviceId: source.id, requestKey }, include: { files: { orderBy: { ordinal: "asc" } } } });
    if (old) {
      if (old.targetDeviceId !== targetId || old.files.length !== files.length || old.files.some((f, i) => f.filename !== files[i].filename || f.mimeType !== files[i].mimeType || Number(f.size) !== files[i].size || f.sha256 !== files[i].sha256)) return null;
      return getBatch(old.id, source);
    }
  }
  const active = await prisma.linkShareBatch.count({ where: { sourceDeviceId: source.id, status: { in: ["assembling", "offered", "accepted"] }, expiresAt: { gt: now } } });
  if (active >= 10) return null;
  const batch = await prisma.linkShareBatch.create({ data: {
    sourceDeviceId: source.id, targetDeviceId: targetId, requestKey, expiresAt: new Date(now.getTime() + TTL),
    files: { create: files.map((file, ordinal) => ({ ...file, size: BigInt(file.size), ordinal })) },
  } }).catch(async error => {
    if (requestKey && error && typeof error === "object" && error.code === "P2002") {
      const old = await prisma.linkShareBatch.findFirst({ where: { sourceDeviceId: source.id, requestKey } });
      if (old) return old;
    }
    throw error;
  });
  if (requestKey) {
    const persisted = await prisma.linkBatchFile.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: "asc" } });
    if (batch.targetDeviceId !== targetId || persisted.length !== files.length || persisted.some((f, i) => f.filename !== files[i].filename || f.mimeType !== files[i].mimeType || Number(f.size) !== files[i].size || f.sha256 !== files[i].sha256)) return null;
  }
  return getBatch(batch.id, source);
}

async function authorizedBatch(id: string, device: Device) {
  const batch = await prisma.linkShareBatch.findFirst({ where: { id, expiresAt: { gt: new Date() }, OR: [{ sourceDeviceId: device.id }, { targetDeviceId: device.id }] }, include: { files: { orderBy: { ordinal: "asc" } } } });
  if (!batch) return null;
  const source = await prisma.linkDevice.findFirst({ where: { id: batch.sourceDeviceId, revokedAt: null, user: { disabled: false } } });
  if (!source || !await resolveShareTarget(source, batch.targetDeviceId, "file")) return null;
  const target = await prisma.linkDevice.findFirst({ where: { id: batch.targetDeviceId, revokedAt: null, user: { disabled: false } } });
  try {
    if (!target || !JSON.parse(source.permissions).includes("share.relay") || !JSON.parse(target.permissions).includes("share.relay")) return null;
  } catch { return null; }
  return batch;
}

export async function getBatch(id: string, device: Device) {
  const batch = await authorizedBatch(id, device);
  if (!batch) return null;
  const sessions = await prisma.linkUploadSession.findMany({ where: { batchFileId: { in: batch.files.map(f => f.id) } }, select: { id: true, batchFileId: true, offset: true } });
  const files = batch.files.map(file => {
    const session = sessions.find(s => s.batchFileId === file.id);
    return { id: file.id, filename: file.filename, mimeType: file.mimeType, size: Number(file.size), sha256: file.sha256, uploadedBytes: file.transferId ? Number(file.size) : Number(session?.offset ?? 0), downloadedBytes: Number(file.downloadedBytes), received: !!file.receivedAt, uploadId: device.id === batch.sourceDeviceId ? session?.id ?? null : null,
      downloadUrl: file.transferId && ["accepted", "completed"].includes(batch.status) && device.id === batch.targetDeviceId ? `/api/link/mobile/share/file/${file.transferId}` : null };
  });
  return { id: batch.id, status: batch.status, sourceDeviceId: batch.sourceDeviceId, targetDeviceId: batch.targetDeviceId, expiresAt: batch.expiresAt.toISOString(), files, progress: batchProgress(files) };
}

export async function changeBatch(id: string, device: Device, input: Record<string, unknown>) {
  const batch = await authorizedBatch(id, device);
  if (!batch) return false;
  if (input.action === "publish" && device.id === batch.sourceDeviceId) {
    if (["offered", "accepted", "completed"].includes(batch.status)) return true;
    if (batch.status !== "assembling" || batch.files.some(f => !f.transferId)) return false;
    const target = await resolveShareTarget(device, batch.targetDeviceId, "file");
    if (!target) return false;
    const transfers = await prisma.linkFileTransfer.count({ where: { batchId: id, expiresAt: { gt: new Date() } } });
    if (transfers !== batch.files.length) return false;
    return prisma.$transaction(async tx => {
      const queued = await tx.linkDeviceEvent.count({ where: { deviceId: batch.targetDeviceId, kind: "share.offer", deliveredAt: null } });
      if (queued >= 20) return false;
      const changed = await tx.linkShareBatch.updateMany({ where: { id, status: "assembling", expiresAt: { gt: new Date() } }, data: { status: "offered" } });
      if (!changed.count) return true;
      await tx.linkDeviceEvent.create({ data: { id: `batch-${id}`, deviceId: batch.targetDeviceId, kind: "share.offer", payload: JSON.stringify({ type: "file.batch", batchId: id, fileCount: batch.files.length, totalBytes: batch.files.reduce((n, f) => n + Number(f.size), 0), sourceName: device.name, sameAccount: target.userId === device.userId }) } });
      return true;
    });
  }
  if ((input.action === "accept" || input.action === "reject") && device.id === batch.targetDeviceId) {
    const status = input.action === "accept" ? "accepted" : "rejected";
    if (batch.status === status) {
      if (status === "rejected") await releaseBatchFiles(id, batch.targetDeviceId);
      return true;
    }
    const changed = await prisma.linkShareBatch.updateMany({ where: { id, targetDeviceId: device.id, status: "offered", expiresAt: { gt: new Date() } }, data: { status } });
    if (changed.count && status === "rejected") await releaseBatchFiles(id, batch.targetDeviceId);
    return changed.count === 1;
  }
  if (input.action === "cancel" && device.id === batch.sourceDeviceId) {
    if (batch.status === "canceled") { await releaseBatchFiles(id, batch.targetDeviceId); return true; }
    const changed = await prisma.linkShareBatch.updateMany({ where: { id, status: { in: ["assembling", "offered", "accepted"] } }, data: { status: "canceled" } });
    if (changed.count) await releaseBatchFiles(id, batch.targetDeviceId);
    return changed.count === 1;
  }
  if (input.action === "received" && device.id === batch.targetDeviceId && ["accepted", "completed"].includes(batch.status)) {
    const file = batch.files.find(f => f.id === input.fileId);
    if (!file || input.sha256 !== file.sha256 || input.size !== Number(file.size)) return false;
    return prisma.$transaction(async tx => {
      const state = await tx.linkShareBatch.findUnique({ where: { id } });
      if (!state || !["accepted", "completed"].includes(state.status)) return false;
      await tx.linkBatchFile.update({ where: { id: file.id }, data: { receivedAt: file.receivedAt ?? new Date(), downloadedBytes: file.size } });
      if (!await tx.linkBatchFile.count({ where: { batchId: id, receivedAt: null } })) await tx.linkShareBatch.update({ where: { id }, data: { status: "completed" } });
      return true;
    });
  }
  if (input.action === "progress" && device.id === batch.targetDeviceId && batch.status === "accepted") {
    const file = batch.files.find(f => f.id === input.fileId);
    if (!file || file.receivedAt || typeof input.bytes !== "number" || !Number.isSafeInteger(input.bytes) || input.bytes < 0 || input.bytes > Number(file.size)) return false;
    return (await prisma.linkBatchFile.updateMany({ where: { id: file.id, receivedAt: null, batch: { status: "accepted", expiresAt: { gt: new Date() } } }, data: { downloadedBytes: BigInt(input.bytes) } })).count === 1;
  }
  return false;
}
