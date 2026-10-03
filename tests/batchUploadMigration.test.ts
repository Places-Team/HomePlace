import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { migrateBatchUploadIdentity } from "../scripts/migrate-batch-upload-identity.mjs";

async function disposableDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "homeplace-batch-migration-test-"));
  const db = new PrismaClient({ datasources: { db: { url: `file:${directory}/test.db` } } });
  return { directory, db };
}

test("batch upload migration preserves legacy sessions and is idempotent", async () => {
  const { directory, db } = await disposableDatabase();
  try {
    await db.$executeRawUnsafe('CREATE TABLE "LinkUploadSession" ("id" TEXT PRIMARY KEY, "marker" TEXT)');
    await db.$executeRawUnsafe('INSERT INTO "LinkUploadSession" ("id", "marker") VALUES (\'existing\', \'kept\')');
    await migrateBatchUploadIdentity(db, directory);
    await migrateBatchUploadIdentity(db, directory);
    const columns = await db.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("LinkUploadSession")');
    const indexes = await db.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA index_list("LinkUploadSession")');
    const rows = await db.$queryRawUnsafe<Array<{ id: string; marker: string }>>('SELECT id, marker FROM "LinkUploadSession"');
    assert.ok(columns.some((column) => column.name === "batchFileId"));
    assert.ok(indexes.some((index) => index.name === "LinkUploadSession_batchFileId_key"));
    assert.deepEqual(rows, [{ id: "existing", marker: "kept" }]);
    await db.$executeRawUnsafe('INSERT INTO "LinkUploadSession" ("id", "batchFileId") VALUES (\'first\', \'same\')');
    await assert.rejects(db.$executeRawUnsafe('INSERT INTO "LinkUploadSession" ("id", "batchFileId") VALUES (\'second\', \'same\')'));
  } finally {
    await db.$disconnect();
  }
});

test("duplicate existing batch identities are rejected without replacing rows", async () => {
  const { directory, db } = await disposableDatabase();
  try {
    await db.$executeRawUnsafe('CREATE TABLE "LinkUploadSession" ("id" TEXT PRIMARY KEY, "batchFileId" TEXT)');
    await db.$executeRawUnsafe('INSERT INTO "LinkUploadSession" ("id", "batchFileId") VALUES (\'first\', \'same\'), (\'second\', \'same\')');
    await assert.rejects(migrateBatchUploadIdentity(db, directory), /duplicate/i);
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>('SELECT id FROM "LinkUploadSession" ORDER BY id');
    assert.deepEqual(rows, [{ id: "first" }, { id: "second" }]);
  } finally {
    await db.$disconnect();
  }
});
