import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";
import { encrypt, decrypt } from "./secretBox";
import { availableFileLimit } from "./fileUploadPolicy";
import { MAX_SHARE_FILE_BYTES, safeFilename } from "./linkShare";
import { createFileTransfer, discardFileTransfer } from "./linkFiles";
import { queueShareOffer, resolveShareTarget } from "./linkDevices";

export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60_000;

function sessionDir(id: string) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error("invalid upload id");
  return path.join(process.env.DATA_DIR?.trim() || "/data", "link-upload-sessions", id);
}

export async function pruneUploadSessions() {
  const rows = await prisma.linkUploadSession.findMany({ where: { expiresAt: { lte: new Date() } }, select: { id: true }, take: 20 });
  for (const row of rows) {
    await prisma.linkUploadSession.deleteMany({ where: { id: row.id, expiresAt: { lte: new Date() } } });
    await rm(sessionDir(row.id), { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function beginUpload(input: {
  source: { id: string; userId: string; capabilities: string };
  targetDeviceId: string;
  filename: string;
  mimeType: string;
  size: number;
}) {
  await pruneUploadSessions();
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_SHARE_FILE_BYTES || input.size > await availableFileLimit()) {
    return { error: "file exceeds server limit or available storage" } as const;
  }
  const target = await resolveShareTarget(input.source, input.targetDeviceId, "file");
  if (!target) return { error: "target device unavailable" } as const;
  const active = await prisma.linkUploadSession.count({ where: { sourceDeviceId: input.source.id, status: { in: ["uploading", "finalizing"] }, expiresAt: { gt: new Date() } } });
  if (active >= 3) return { error: "too many active uploads" } as const;
  const key = randomBytes(32);
  const session = await prisma.linkUploadSession.create({
    data: {
      sourceDeviceId: input.source.id, targetDeviceId: target.id,
      filename: safeFilename(input.filename), mimeType: input.mimeType.slice(0, 120),
      size: BigInt(input.size), encryptedKey: await encrypt(key.toString("base64")),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { id: session.id, offset: 0, chunkBytes: UPLOAD_CHUNK_BYTES, expiresAt: session.expiresAt.toISOString() } as const;
}

export async function uploadStatus(id: string, sourceDeviceId: string) {
  const row = await prisma.linkUploadSession.findFirst({
    where: { id, sourceDeviceId, expiresAt: { gt: new Date() } },
    select: { id: true, size: true, offset: true, status: true, expiresAt: true },
  });
  return row ? { id: row.id, size: Number(row.size), offset: Number(row.offset), status: row.status, expiresAt: row.expiresAt.toISOString() } : null;
}

export async function cancelUpload(id: string, sourceDeviceId: string) {
  const deleted = await prisma.linkUploadSession.deleteMany({ where: { id, sourceDeviceId, status: "uploading" } });
  if (!deleted.count) return false;
  await rm(sessionDir(id), { recursive: true, force: true }).catch(() => undefined);
  return true;
}

export async function appendUploadChunk(id: string, sourceDeviceId: string, offset: number, bytes: Buffer) {
  const row = await prisma.linkUploadSession.findFirst({ where: { id, sourceDeviceId, status: "uploading", expiresAt: { gt: new Date() } } });
  if (!row) return { error: "upload unavailable", status: 404 } as const;
  const current = Number(row.offset);
  if (offset !== current) return { error: "offset mismatch", offset: current, status: 409 } as const;
  if (bytes.length < 1 || bytes.length > UPLOAD_CHUNK_BYTES || current + bytes.length > Number(row.size)) {
    return { error: "invalid chunk size", status: 400 } as const;
  }
  const key = Buffer.from(await decrypt(row.encryptedKey), "base64");
  if (key.length !== 32) throw new Error("invalid upload key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, String(current));
  try {
    await writeFile(file, encrypted, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // Recover from a process crash after the durable chunk write but before
      // the database offset advanced. Only accept a byte-identical retry.
      const existing = await readFile(file).catch(() => null);
      if (existing && existing.length >= 29) {
        try {
          const decipher = createDecipheriv("aes-256-gcm", key, existing.subarray(0, 12));
          decipher.setAuthTag(existing.subarray(existing.length - 16));
          const plain = Buffer.concat([decipher.update(existing.subarray(12, -16)), decipher.final()]);
          if (plain.equals(bytes)) {
            const advanced = await prisma.linkUploadSession.updateMany({
              where: { id, sourceDeviceId, status: "uploading", offset: BigInt(current) },
              data: { offset: BigInt(current + bytes.length) },
            });
            if (advanced.count) return { offset: current + bytes.length } as const;
          }
        } catch { /* In-flight or corrupt chunk; let the caller retry. */ }
      }
      return { error: "chunk already being uploaded", offset: current, status: 409 } as const;
    }
    throw error;
  }
  const changed = await prisma.linkUploadSession.updateMany({
    where: { id, sourceDeviceId, status: "uploading", offset: BigInt(current), expiresAt: { gt: new Date() } },
    data: { offset: BigInt(current + bytes.length) },
  });
  if (!changed.count) {
    const latest = await uploadStatus(id, sourceDeviceId);
    if (latest?.offset === current + bytes.length) return { offset: latest.offset } as const;
    await rm(file, { force: true });
    return { error: "upload state changed", status: 409 } as const;
  }
  return { offset: current + bytes.length } as const;
}

export async function finishUpload(id: string, source: { id: string; userId: string; capabilities: string; name: string }) {
  const row = await prisma.linkUploadSession.findFirst({ where: { id, sourceDeviceId: source.id, expiresAt: { gt: new Date() } } });
  if (!row) return { error: "upload unavailable", status: 404 } as const;
  if (row.status !== "uploading" || row.offset !== row.size) return { error: "upload is incomplete", status: 409 } as const;
  const target = await resolveShareTarget(source, row.targetDeviceId, "file");
  if (!target) return { error: "target device unavailable", status: 404 } as const;
  const claimed = await prisma.linkUploadSession.updateMany({ where: { id, status: "uploading", offset: row.size }, data: { status: "finalizing" } });
  if (!claimed.count) return { error: "upload is already finalizing", status: 409 } as const;
  try {
    const key = Buffer.from(await decrypt(row.encryptedKey), "base64");
    if (key.length !== 32) throw new Error("invalid upload key");
    const directory = sessionDir(id);
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (offset >= Number(row.size)) { controller.close(); return; }
          const file = await readFile(path.join(directory, String(offset)));
          if (file.length < 29) throw new Error("invalid upload chunk");
          const decipher = createDecipheriv("aes-256-gcm", key, file.subarray(0, 12));
          decipher.setAuthTag(file.subarray(file.length - 16));
          const plain = Buffer.concat([decipher.update(file.subarray(12, -16)), decipher.final()]);
          offset += plain.length;
          if (plain.length < 1 || offset > Number(row.size)) throw new Error("invalid upload chunk length");
          controller.enqueue(plain);
        } catch (error) { controller.error(error); }
      },
    });
    const transfer = await createFileTransfer({
      sourceDeviceId: source.id, targetDeviceId: target.id, filename: row.filename,
      mimeType: row.mimeType, size: Number(row.size), stream,
    });
    const queued = await queueShareOffer(target.id, {
      type: "file", transferId: transfer.id, filename: transfer.filename, mimeType: transfer.mimeType,
      size: Number(transfer.size), sha256: transfer.sha256, sourceName: source.name,
      sameAccount: target.userId === source.userId,
    });
    if (!queued) {
      await discardFileTransfer(transfer.id, target.id);
      return { error: "target device has too many pending offers", status: 429 } as const;
    }
    await prisma.linkUploadSession.delete({ where: { id } });
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    return { transferId: transfer.id, sha256: transfer.sha256 } as const;
  } finally {
    await prisma.linkUploadSession.updateMany({ where: { id, status: "finalizing" }, data: { status: "uploading" } });
  }
}
