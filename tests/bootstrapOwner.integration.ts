import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createInitialOwner } from "../src/lib/bootstrapOwner";

if (!process.env.DATABASE_URL?.includes("homeplace-security-test")) {
  throw new Error("Run only against a disposable homeplace-security-test database");
}

const prisma = new PrismaClient();

test("concurrent first-run requests create exactly one owner and dashboard", async () => {
  try {
    const attempts = await Promise.all([
      createInitialOwner(prisma, { name: "First", login: "first", passwordHash: "test-hash", locale: "en" }),
      createInitialOwner(prisma, { name: "Second", login: "second", passwordHash: "test-hash", locale: "en" }),
    ]);

    assert.equal(attempts.filter(Boolean).length, 1);
    assert.equal(await prisma.user.count({ where: { role: "owner" } }), 1);
    assert.equal(await prisma.dashboard.count(), 1);
    assert.equal(await prisma.setting.count({ where: { key: "setup.initialOwner" } }), 1);
    assert.equal(await createInitialOwner(prisma, {
      name: "Third", login: "third", passwordHash: "test-hash", locale: "en",
    }), null);
  } finally {
    await prisma.$disconnect();
  }
});
