import "server-only";
import type { Exchange } from "@prisma/client";
import { prisma } from "./db";
import { decrypt, encrypt } from "./secretBox";
import { createFileTransfer, discardFileTransfer, openFileTransfer } from "./linkFiles";
import { safeFilename } from "./linkShare";
import { exchangeTokenHash, newExchangeToken, type ExchangeOptions, validExchangeToken } from "./exchangePolicy";

const MAX_ACTIVE = 100;
const MAX_OWNER_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 4 * 1024 * 1024 * 1024;

async function ensureRoom(ownerId: string, incomingBytes = 0): Promise<void> {
  await pruneExpiredExchanges();
  const active = { expiresAt: { gt: new Date() }, openedAt: null };
  const [count, ownerBytes, totalBytes] = await Promise.all([
    prisma.exchange.count({ where: { ownerId, ...active } }),
    incomingBytes ? prisma.exchange.aggregate({ where: { ownerId, kind: "file", ...active }, _sum: { size: true } }) : null,
    incomingBytes ? prisma.exchange.aggregate({ where: { kind: "file", ...active }, _sum: { size: true } }) : null,
  ]);
  if (count >= MAX_ACTIVE) throw new Error("too many active exchanges");
  if (incomingBytes && ((ownerBytes?._sum.size ?? 0) + incomingBytes > MAX_OWNER_FILE_BYTES ||
    (totalBytes?._sum.size ?? 0) + incomingBytes > MAX_TOTAL_FILE_BYTES)) throw new Error("exchange storage quota reached");
}

function expiresAt(options: ExchangeOptions): Date {
  return new Date(Date.now() + options.expiresInSeconds * 1000);
}

export async function createTextExchange(ownerId: string, value: string, options: ExchangeOptions) {
  await ensureRoom(ownerId);
  const token = newExchangeToken();
  const record = await prisma.exchange.create({
    data: {
      ownerId,
      tokenHash: exchangeTokenHash(token),
      encryptedToken: await encrypt(token),
      kind: "text",
      access: options.access,
      encryptedText: await encrypt(value),
      deleteAfterOpen: options.deleteAfterOpen,
      expiresAt: expiresAt(options),
    },
  });
  return ownerView(record, token);
}

export async function createFileExchange(ownerId: string, input: {
  filename: string;
  mimeType: string;
  size: number;
  stream: ReadableStream<Uint8Array>;
}, options: ExchangeOptions) {
  await ensureRoom(ownerId, input.size);
  const token = newExchangeToken();
  const tokenHash = exchangeTokenHash(token);
  const target = `exchange:${tokenHash}`;
  const transfer = await createFileTransfer({
    sourceDeviceId: `exchange:${ownerId}`,
    targetDeviceId: target,
    filename: safeFilename(input.filename),
    mimeType: input.mimeType,
    size: input.size,
    stream: input.stream,
    lifetimeMs: options.expiresInSeconds * 1000,
  });
  try {
    const record = await prisma.exchange.create({
      data: {
        ownerId,
        tokenHash,
        encryptedToken: await encrypt(token),
        kind: "file",
        access: options.access,
        transferId: transfer.id,
        filename: transfer.filename,
        mimeType: transfer.mimeType,
        size: transfer.size,
        deleteAfterOpen: options.deleteAfterOpen,
        expiresAt: expiresAt(options),
      },
    });
    return ownerView(record, token);
  } catch (error) {
    await discardFileTransfer(transfer.id, target);
    throw error;
  }
}

function ownerView(record: Exchange, token: string) {
  return {
    token,
    kind: record.kind,
    access: record.access,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    deleteAfterOpen: record.deleteAfterOpen,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}

export async function listExchanges(ownerId: string) {
  await pruneExpiredExchanges();
  const records = await prisma.exchange.findMany({
    where: { ownerId, expiresAt: { gt: new Date() }, openedAt: null },
    orderBy: { createdAt: "desc" },
    take: MAX_ACTIVE,
  });
  return Promise.all(records.map(async (record) => ownerView(record, await decrypt(record.encryptedToken))));
}

export async function getExchange(token: string) {
  if (!validExchangeToken(token)) return null;
  return prisma.exchange.findFirst({
    where: { tokenHash: exchangeTokenHash(token), expiresAt: { gt: new Date() }, openedAt: null },
  });
}

export function recipientView(record: Exchange) {
  return {
    kind: record.kind,
    access: record.access,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    deleteAfterOpen: record.deleteAfterOpen,
    expiresAt: record.expiresAt.toISOString(),
  };
}

async function claimOnce(record: Exchange): Promise<boolean> {
  if (!record.deleteAfterOpen) return true;
  const result = await prisma.exchange.updateMany({
    where: { id: record.id, openedAt: null, expiresAt: { gt: new Date() } },
    data: { openedAt: new Date(), ...(record.kind === "text" ? { encryptedText: null } : {}) },
  });
  return result.count === 1;
}

export async function openExchangeText(record: Exchange): Promise<string | null> {
  if (record.kind !== "text" || !record.encryptedText || !(await claimOnce(record))) return null;
  const text = (await decrypt(record.encryptedText)) || null;
  if (record.deleteAfterOpen) await prisma.exchange.deleteMany({ where: { id: record.id, openedAt: { not: null } } });
  return text;
}

export async function openExchangeFile(record: Exchange) {
  if (record.kind !== "file" || !record.transferId || !(await claimOnce(record))) return null;
  const target = `exchange:${record.tokenHash}`;
  const file = await openFileTransfer(record.transferId, target);
  if (!file) {
    if (record.deleteAfterOpen) await prisma.exchange.deleteMany({ where: { id: record.id, openedAt: { not: null } } });
    return null;
  }
  if (!record.deleteAfterOpen) return file;

  const reader = file.stream.getReader();
  const cleanup = async () => {
    await discardFileTransfer(record.transferId!, target).catch(() => undefined);
    await prisma.exchange.deleteMany({ where: { id: record.id, openedAt: { not: null } } }).catch(() => undefined);
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const part = await reader.read();
        if (part.done) {
          await cleanup();
          controller.close();
        } else {
          controller.enqueue(part.value);
        }
      } catch (error) {
        controller.error(error);
        await cleanup();
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); }
      finally { await cleanup(); }
    },
  });
  return { ...file, stream };
}

export async function deleteExchange(ownerId: string, token: string): Promise<boolean> {
  if (!validExchangeToken(token)) return false;
  const record = await prisma.exchange.findFirst({ where: { ownerId, tokenHash: exchangeTokenHash(token) } });
  if (!record) return false;
  const result = await prisma.exchange.deleteMany({ where: { id: record.id, ownerId } });
  if (result.count && record.transferId) await discardFileTransfer(record.transferId, `exchange:${record.tokenHash}`);
  return result.count === 1;
}

export async function pruneExpiredExchanges(): Promise<void> {
  const records = await prisma.exchange.findMany({
    where: { expiresAt: { lte: new Date() } },
    select: { id: true, tokenHash: true, transferId: true },
    take: 100,
  });
  if (!records.length) return;
  await prisma.exchange.deleteMany({ where: { id: { in: records.map((record) => record.id) } } });
  await Promise.all(records.map((record) => record.transferId
    ? discardFileTransfer(record.transferId, `exchange:${record.tokenHash}`)
    : Promise.resolve()));
}
