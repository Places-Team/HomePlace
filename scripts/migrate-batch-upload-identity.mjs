import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

/** Add the nullable batch identity and its unique index without dropping upload sessions. */
export async function migrateBatchUploadIdentity(db, dataDir) {
  const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='LinkUploadSession'");
  if (tables.length === 0) return;

  const columns = await db.$queryRawUnsafe('PRAGMA table_info("LinkUploadSession")');
  const column = columns.find((item) => item.name === "batchFileId");
  if (column && column.type.toUpperCase() !== "TEXT") {
    throw new Error("Unexpected batchFileId type; migration refused");
  }
  const indexes = await db.$queryRawUnsafe('PRAGMA index_list("LinkUploadSession")');
  const index = indexes.find((item) => item.name === "LinkUploadSession_batchFileId_key");
  if (index && !column) throw new Error("Batch upload index exists without its column");
  if (index) {
    const fields = await db.$queryRawUnsafe('PRAGMA index_info("LinkUploadSession_batchFileId_key")');
    if (Number(index.unique) !== 1 || fields.length !== 1 || fields[0].name !== "batchFileId") {
      throw new Error("Unexpected batch upload index; migration refused");
    }
    return;
  }

  if (column) {
    const duplicates = await db.$queryRawUnsafe(
      'SELECT batchFileId FROM "LinkUploadSession" WHERE batchFileId IS NOT NULL GROUP BY batchFileId HAVING COUNT(*) > 1 LIMIT 1',
    );
    if (duplicates.length > 0) throw new Error("Duplicate batchFileId values; migration refused");
  }

  const backupDir = path.join(dataDir, "backups");
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, `homeplace-pre-batch-upload-${Date.now()}-${randomBytes(4).toString("hex")}.db`);
  await db.$executeRawUnsafe(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  console.log(`Batch upload migration backup: ${backup}`);

  if (!column) await db.$executeRawUnsafe('ALTER TABLE "LinkUploadSession" ADD COLUMN "batchFileId" TEXT');
  await db.$executeRawUnsafe('CREATE UNIQUE INDEX "LinkUploadSession_batchFileId_key" ON "LinkUploadSession"("batchFileId")');
  const integrity = await db.$queryRawUnsafe("PRAGMA integrity_check");
  if (integrity[0]?.integrity_check !== "ok") throw new Error("Batch upload migration failed integrity check");
  console.log("Batch upload identity migration complete");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const db = new PrismaClient();
  migrateBatchUploadIdentity(db, process.env.DATA_DIR?.trim() || "/data")
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}
