import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Optional browser fixtures, confined to the isolated plant-test database.
assert.match(process.env.DATABASE_URL ?? "", /^file:\/(?:private\/)?tmp\/homeplace-plants-[A-Za-z0-9]{6}\/test\.db$/);
const prisma = new PrismaClient();
async function main() {
  try {
    const owner = await prisma.user.findUniqueOrThrow({ where: { login: "plant-test" } });
    const other = await prisma.user.findFirstOrThrow({ where: { id: { not: owner.id } } });
    await prisma.linkDevice.deleteMany();
    const capabilities = JSON.stringify(["notification.receive", "url.open", "file.receive", "clipboard.send", "clipboard.receive", "text.receive"].map(name => ({ name, version: 1, constraints: {} })));
    for (const [index, [name, platform, version]] of [
      ["Studio MacBook", "macos", "27.0"], ["Galaxy S24 Ultra", "android", "16"], ["Gaming PC", "windows", "11"],
      ["Linux workstation", "linux", "24.04"], ["iPhone", "ios", "19"], ["Unassigned test", "linux", "6.12"],
    ].entries()) {
      await prisma.linkDevice.create({ data: {
        name, platform, platformVersion: version, appVersion: "0.4.6", publicKey: "isolated-test-key",
        credentialHash: randomBytes(32).toString("hex"), capabilities, approvedCapabilities: capabilities,
        userId: index === 5 ? null : index === 4 ? other.id : owner.id,
        permissions: JSON.stringify(["dashboard.read", "calendar.read", "calendar.manage", "reminder.manage", "plants.manage", "share.relay"]),
        lastSeenAt: new Date(Date.now() - (index % 2 === 0 ? 1000 : 300000)),
      } });
    }
    console.log("Seeded isolated device workspace fixtures.");
  } finally { await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
