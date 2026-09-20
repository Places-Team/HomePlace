import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import path from "node:path";
import { prisma } from "./db";
import { decrypt, encrypt } from "./secretBox";
import { MAX_SHARE_FILE_BYTES, SHARE_LIFETIME_MS, safeFilename } from "./linkShare";

const HEADER_BYTES = 28;

async function writeFully(handle: FileHandle, bytes: Buffer, position: number) {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, position + offset);
    if (result.bytesWritten < 1) throw new Error("file write stopped unexpectedly");
    offset += result.bytesWritten;
  }
}

function transferDir() {
  return path.join(process.env.DATA_DIR?.trim() || "/data", "link-transfers");
}

export async function createFileTransfer(input: {
  sourceDeviceId: string;
  targetDeviceId: string;
  filename: string;
  mimeType: string;
  size: number;
  stream: ReadableStream<Uint8Array>;
}) {
  await pruneExpiredFileTransfers();
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_SHARE_FILE_BYTES) {
    throw new Error("invalid file size");
  }

  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const hash = createHash("sha256");
  const storageName = randomBytes(24).toString("hex");
  const storagePath = path.join(transferDir(), storageName);
  await mkdir(transferDir(), { recursive: true, mode: 0o700 });
  const handle = await open(storagePath, "wx", 0o600);
  let position = HEADER_BYTES;
  let received = 0;
  const reader = input.stream.getReader();

  try {
    await writeFully(handle, Buffer.alloc(HEADER_BYTES), 0);
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      received += chunk.length;
      if (received > input.size || received > MAX_SHARE_FILE_BYTES) {
        await reader.cancel("file is too large").catch(() => undefined);
        throw new Error("file is too large");
      }
      hash.update(chunk);
      const encrypted = cipher.update(chunk);
      if (encrypted.length) {
        await writeFully(handle, encrypted, position);
        position += encrypted.length;
      }
    }
    if (received !== input.size) throw new Error("file size changed during upload");
    const final = cipher.final();
    if (final.length) {
      await writeFully(handle, final, position);
      position += final.length;
    }
    if (position !== HEADER_BYTES + input.size) throw new Error("encrypted file size mismatch");
    await writeFully(handle, Buffer.concat([iv, cipher.getAuthTag()]), 0);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(storagePath).catch(() => undefined);
    throw error;
  }
  await handle.close();

  try {
    const transfer = await prisma.linkFileTransfer.create({
      data: {
        sourceDeviceId: input.sourceDeviceId,
        targetDeviceId: input.targetDeviceId,
        encryptedKey: await encrypt(key.toString("base64")),
        storageName,
        filename: safeFilename(input.filename),
        mimeType: input.mimeType.slice(0, 120),
        size: received,
        sha256: hash.digest("hex"),
        expiresAt: new Date(Date.now() + SHARE_LIFETIME_MS),
      },
    });
    setTimeout(() => void discardFileTransfer(transfer.id, transfer.targetDeviceId), SHARE_LIFETIME_MS + 1_000).unref();
    return transfer;
  } catch (error) {
    await unlink(storagePath).catch(() => undefined);
    throw error;
  }
}

export async function discardFileTransfer(id: string, targetDeviceId: string) {
  const transfer = await prisma.linkFileTransfer.findFirst({ where: { id, targetDeviceId } });
  if (!transfer) return;
  await prisma.linkFileTransfer.deleteMany({ where: { id, targetDeviceId } });
  await unlink(path.join(transferDir(), transfer.storageName)).catch(() => undefined);
}

export async function openFileTransfer(id: string, targetDeviceId: string) {
  const transfer = await prisma.linkFileTransfer.findFirst({
    where: { id, targetDeviceId, expiresAt: { gt: new Date() } },
  });
  if (!transfer) return null;
  const key = Buffer.from(await decrypt(transfer.encryptedKey), "base64");
  if (key.length !== 32) return null;
  const storagePath = path.join(transferDir(), transfer.storageName);
  const handle = await open(storagePath, "r").catch(() => null);
  if (!handle) return null;
  const header = Buffer.alloc(HEADER_BYTES);
  const read = await handle.read(header, 0, HEADER_BYTES, 0).catch(() => null);
  await handle.close();
  if (!read || read.bytesRead !== HEADER_BYTES) return null;

  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(0, 12));
  decipher.setAuthTag(header.subarray(12, HEADER_BYTES));
  const hash = createHash("sha256");
  let size = 0;
  const verify = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      const valid = size === transfer.size && hash.digest("hex") === transfer.sha256;
      callback(valid ? undefined : new Error("file integrity check failed"));
    },
  });
  const stream = createReadStream(storagePath, { start: HEADER_BYTES }).pipe(decipher).pipe(verify);
  return {
    stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    size: transfer.size,
    filename: transfer.filename,
    mimeType: transfer.mimeType,
    sha256: transfer.sha256,
  };
}

export async function pruneExpiredFileTransfers() {
  const expired = await prisma.linkFileTransfer.findMany({
    where: { expiresAt: { lte: new Date() } },
    select: { id: true, storageName: true },
    take: 100,
  });
  if (!expired.length) return;
  await prisma.linkFileTransfer.deleteMany({ where: { id: { in: expired.map((item) => item.id) } } });
  await Promise.all(expired.map((item) => unlink(path.join(transferDir(), item.storageName)).catch(() => undefined)));
}
