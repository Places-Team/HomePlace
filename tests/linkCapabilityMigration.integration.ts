import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { migrateLegacyLinkCapabilities, reconcileLegacyLinkDevices } from "../src/lib/linkCapabilityMigration";

if (!process.env.DATABASE_URL?.includes("homeplace-security-test")) {
  throw new Error("Run only against a disposable homeplace-security-test database");
}
const db = new PrismaClient();
const approved = JSON.stringify([{ name: "clipboard.send", version: 1, constraints: {} }]);
const inflated = JSON.stringify([
  { name: "clipboard.send", version: 1, constraints: {} },
  { name: "file.receive", version: 1, constraints: {} },
]);

async function device(label: string, capabilities: string) {
  return db.linkDevice.create({ data: {
    name: label, platform: "macos", platformVersion: "1", appVersion: "1",
    publicKey: label, credentialHash: `hash-${label}`, capabilities,
  } });
}

async function pairing(deviceId: string, label: string, capabilities: string) {
  return db.linkPairing.create({ data: {
    claimSecretHash: `claim-${label}`, status: "claimed", name: label,
    platform: "macos", platformVersion: "1", appVersion: "1",
    publicKey: label, capabilities, expiresAt: new Date(Date.now() + 60_000), deviceId,
  } });
}

test("legacy reconciliation removes capabilities added after approval", async () => {
  try {
    const row = await device("inflated", inflated);
    await pairing(row.id, "inflated", approved);
    assert.equal(await migrateLegacyLinkCapabilities(db, row.id, row.credentialHash), true);
    const migrated = await db.linkDevice.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(migrated.approvedCapabilities, approved);
    assert.equal(migrated.capabilities, "[]");
  } finally {
    await db.$disconnect();
  }
});

test("ambiguous legacy approval history requires re-pairing", async () => {
  try {
    const row = await device("ambiguous", inflated);
    await pairing(row.id, "first", approved);
    await pairing(row.id, "second", inflated);
    assert.equal(await migrateLegacyLinkCapabilities(db, row.id, row.credentialHash), false);
    const unchanged = await db.linkDevice.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(unchanged.approvedCapabilities, null);
  } finally {
    await db.$disconnect();
  }
});

test("legacy device without a trusted pairing cannot authenticate", async () => {
  try {
    const row = await device("missing-pairing", inflated);
    assert.equal(await migrateLegacyLinkCapabilities(db, row.id, row.credentialHash), false);
    assert.equal((await db.linkDevice.findUniqueOrThrow({ where: { id: row.id } })).approvedCapabilities, null);
  } finally {
    await db.$disconnect();
  }
});

test("an ordinary approved legacy subset remains available", async () => {
  try {
    const row = await device("safe-subset", approved);
    await pairing(row.id, "safe-subset", approved);
    assert.equal(await migrateLegacyLinkCapabilities(db, row.id, row.credentialHash), true);
    const migrated = await db.linkDevice.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(migrated.approvedCapabilities, approved);
    assert.equal(migrated.capabilities, approved);
  } finally {
    await db.$disconnect();
  }
});

test("an offline legacy recipient is reconciled before target selection", async () => {
  try {
    const row = await device("offline-recipient", approved);
    await pairing(row.id, "offline-recipient", approved);
    await reconcileLegacyLinkDevices(db, [row.id]);
    const recipient = await db.linkDevice.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(recipient.approvedCapabilities, approved);
    assert.equal(recipient.capabilities, approved);
  } finally {
    await db.$disconnect();
  }
});
