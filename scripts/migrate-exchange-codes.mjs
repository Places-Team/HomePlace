import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dataDir = process.env.DATA_DIR?.trim() || "/data";

async function main() {
  const table = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='Exchange'");
  if (!table.length) return;
  const columns = await prisma.$queryRawUnsafe("PRAGMA table_info('Exchange')");
  const indexes = await prisma.$queryRawUnsafe("PRAGMA index_list('Exchange')");
  const hasCode = columns.some((column) => column.name === "shortCodeHash");
  const hasEncryptedCode = columns.some((column) => column.name === "encryptedShortCode");
  const hasIndex = indexes.some((index) => index.name === "Exchange_shortCodeHash_key");
  if (hasCode && hasEncryptedCode && hasIndex) return;

  const backupDir = path.join(dataDir, "backups");
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, `homeplace-pre-short-code-${Date.now()}-${randomBytes(4).toString("hex")}.db`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  console.log(`Short-code migration backup: ${backup}`);

  if (!hasCode) await prisma.$executeRawUnsafe("ALTER TABLE Exchange ADD COLUMN shortCodeHash TEXT");
  if (!hasEncryptedCode) await prisma.$executeRawUnsafe("ALTER TABLE Exchange ADD COLUMN encryptedShortCode TEXT");
  await prisma.$executeRawUnsafe("CREATE UNIQUE INDEX IF NOT EXISTS Exchange_shortCodeHash_key ON Exchange(shortCodeHash)");

  const integrity = await prisma.$queryRawUnsafe("PRAGMA integrity_check");
  if (integrity[0]?.integrity_check !== "ok") throw new Error("Short-code migration failed integrity check");
  console.log("Short-code migration complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
