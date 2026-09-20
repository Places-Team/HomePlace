import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";
import { decrypt, encrypt } from "./secretBox";
import { SHARE_LIFETIME_MS, safeFilename } from "./linkShare";

function transferDir() {
  return path.join(process.env.DATA_DIR?.trim() || "/data", "link-transfers");
}

export async function createFileTransfer(input: {
  sourceDeviceId: string;
  targetDeviceId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}) {
  await pruneExpiredFileTransfers();
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encryptedBody = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
  const stored = Buffer.concat([iv, cipher.getAuthTag(), encryptedBody]);
  const storageName = randomBytes(24).toString("hex");
  await mkdir(transferDir(), { recursive: true, mode: 0o700 });
  await writeFile(path.join(transferDir(), storageName), stored, { mode: 0o600 });
  try {
    const transfer = await prisma.linkFileTransfer.create({
      data: {
        sourceDeviceId: input.sourceDeviceId,
        targetDeviceId: input.targetDeviceId,
        encryptedKey: await encrypt(key.toString("base64")),
        storageName,
        filename: safeFilename(input.filename),
        mimeType: input.mimeType.slice(0, 120),
        size: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        expiresAt: new Date(Date.now() + SHARE_LIFETIME_MS),
      },
    });
    setTimeout(() => void discardFileTransfer(transfer.id, transfer.targetDeviceId), SHARE_LIFETIME_MS + 1_000).unref();
    return transfer;
  } catch (error) {
    await unlink(path.join(transferDir(), storageName)).catch(() => undefined);
    throw error;
  }
}

export async function discardFileTransfer(id: string, targetDeviceId: string) {
  const transfer = await prisma.linkFileTransfer.findFirst({ where: { id, targetDeviceId } });
  if (!transfer) return;
  await prisma.linkFileTransfer.deleteMany({ where: { id, targetDeviceId } });
  await unlink(path.join(transferDir(), transfer.storageName)).catch(() => undefined);
}

export async function readFileTransfer(id: string, targetDeviceId: string) {
  const transfer = await prisma.linkFileTransfer.findFirst({
    where: { id, targetDeviceId, expiresAt: { gt: new Date() } },
  });
  if (!transfer) return null;
  const stored = await readFile(path.join(transferDir(), transfer.storageName)).catch(() => null);
  if (!stored) return null;
  const key = Buffer.from(await decrypt(transfer.encryptedKey), "base64");
  if (key.length !== 32 || stored.length < 29) return null;
  const decipher = createDecipheriv("aes-256-gcm", key, stored.subarray(0, 12));
  decipher.setAuthTag(stored.subarray(12, 28));
  const bytes = Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()]);
  if (bytes.length !== transfer.size || createHash("sha256").update(bytes).digest("hex") !== transfer.sha256) return null;
  return { bytes, filename: transfer.filename, mimeType: transfer.mimeType, sha256: transfer.sha256 };
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
