import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dataDir = process.env.DATA_DIR?.trim() || "/data";
const schema = path.resolve("prisma/schema.prisma");
const template = path.resolve("scripts/migrations/file-size-v1.sql");

async function columnType(table) {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  return rows.find((row) => row.name === "size")?.type?.toUpperCase() ?? null;
}

async function main() {
  const exchangeType = await columnType("Exchange");
  const transferType = await columnType("LinkFileTransfer");
  const known = new Set([null, "INTEGER", "INT", "BIGINT"]);
  if (!known.has(exchangeType) || !known.has(transferType)) {
    throw new Error("Unexpected file-size column type; automatic migration refused");
  }
  const migrateExchange = exchangeType === "INTEGER" || exchangeType === "INT";
  const migrateTransfer = transferType === "INTEGER" || transferType === "INT";
  if (!migrateExchange && !migrateTransfer) return;

  const sql = await readFile(template, "utf8");
  const exchangeStart = sql.indexOf('CREATE TABLE "new_Exchange"');
  const transferStart = sql.indexOf('CREATE TABLE "new_LinkFileTransfer"');
  const end = sql.indexOf("PRAGMA foreign_keys=ON;", transferStart);
  if (exchangeStart < 0 || transferStart < 0 || end < 0) throw new Error("File-size migration template is incomplete");

  const backupDir = path.join(dataDir, "backups");
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, `homeplace-pre-file-size-${Date.now()}-${randomBytes(4).toString("hex")}.db`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  console.log(`File-size migration backup: ${backup}`);
  await prisma.$disconnect();

  const selected = [
    "PRAGMA defer_foreign_keys=ON;",
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
    migrateExchange ? sql.slice(exchangeStart, transferStart).trim() : "",
    migrateTransfer ? sql.slice(transferStart, end).trim() : "",
    "COMMIT;",
    "PRAGMA foreign_keys=ON;",
    "PRAGMA defer_foreign_keys=OFF;",
  ].filter(Boolean).join("\n\n");
  const migrationFile = path.join(dataDir, `.file-size-migration-${process.pid}.sql`);
  await writeFile(migrationFile, selected, { mode: 0o600, flag: "wx" });
  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--file", migrationFile, "--schema", schema], { stdio: "inherit" });
  } finally {
    await unlink(migrationFile);
  }

  await prisma.$connect();
  const [newExchangeType, newTransferType] = await Promise.all([columnType("Exchange"), columnType("LinkFileTransfer")]);
  if ((migrateExchange && newExchangeType !== "BIGINT") || (migrateTransfer && newTransferType !== "BIGINT")) {
    throw new Error("File-size migration did not update the expected columns");
  }
  const integrity = await prisma.$queryRawUnsafe("PRAGMA integrity_check");
  if (integrity[0]?.integrity_check !== "ok") throw new Error("Database integrity check failed after file-size migration");
  console.log("File-size migration complete");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
