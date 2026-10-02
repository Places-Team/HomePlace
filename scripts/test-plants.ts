import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma, setSetting } from "../src/lib/db";
import { GET as list, POST as change } from "../src/app/api/link/plants/route";
import {
  GET as getPhoto,
  POST as upload,
  DELETE as deletePhoto,
} from "../src/app/api/link/plants/[clientId]/photo/route";
import { PATCH as settings } from "../src/app/api/link/plants/settings/route";
import { processPlantReminders } from "../src/lib/plantReminders";
import { notificationFeed } from "../src/lib/notifications";

async function main() {
  assert.ok(
    /^file:\/(?:private\/)?tmp\/homeplace-plants-[A-Za-z0-9]{6}\/test\.db$/.test(
      process.env.DATABASE_URL ?? "",
    ),
    "Use a dedicated temporary plant-test database.",
  );
  assert.ok(
    /^\/(?:private\/)?tmp\/homeplace-plants-[A-Za-z0-9]{6}$/.test(
      process.env.DATA_DIR ?? "",
    ),
    "Use a dedicated temporary data directory.",
  );
  const owner = await prisma.user.create({
    data: {
      name: "Plant test",
      login: "plant-test",
      locale: "ru",
      role: "owner",
      passwordHash: await bcrypt.hash("local-plant-check", 10),
    },
  });
  const other = await prisma.user.create({ data: { name: "Other account" } });
  const token = randomBytes(32).toString("base64url");
  const otherToken = randomBytes(32).toString("base64url");
  const restrictedToken = randomBytes(32).toString("base64url");
  async function device(
    userId: string,
    credential: string,
    permissions: string[],
  ) {
    return prisma.linkDevice.create({
      data: {
        name: "Test device",
        platform: "android",
        platformVersion: "test",
        appVersion: "test",
        publicKey: "test-key",
        userId,
        credentialHash: createHash("sha256").update(credential).digest("hex"),
        permissions: JSON.stringify(permissions),
        capabilities: JSON.stringify([
          { name: "notification.receive", version: 1 },
        ]),
      },
    });
  }
  const approved = await device(owner.id, token, ["plants.manage"]);
  await device(other.id, otherToken, ["plants.manage"]);
  await device(owner.id, restrictedToken, []);
  const headers = (credential = token) => ({
    authorization: `Bearer ${credential}`,
  });
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    credential = token,
  ) =>
    new Request(`http://localhost:3201${path}`, {
      method,
      headers: {
        ...headers(credential),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const id = randomUUID();
  const context = { params: Promise.resolve({ clientId: id }) };
  const now = new Date();
  const payload = {
    action: "create",
    clientId: id,
    name: "Монстера",
    species: "Monstera deliciosa",
    location: "Гостиная",
    notes: "Не переливать.",
    intervalDays: 1,
    lastWateredAt: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
  };
  try {
    assert.equal(
      (
        await list(
          request("/api/link/plants", "GET", undefined, restrictedToken),
        )
      ).status,
      403,
    );
    assert.equal(
      (await change(request("/api/link/plants", "POST", payload))).status,
      201,
    );
    assert.equal(
      (await change(request("/api/link/plants", "POST", payload))).status,
      200,
    );
    let row = (await (await list(request("/api/link/plants"))).json())
      .plants[0];
    assert.equal(row.remindersEnabled, true);
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR90AAAAASUVORK5CYII=",
      "base64",
    );
    const photoRequest = (
      revision: number,
      data: Buffer = bytes,
      type = "image/png",
    ) =>
      new Request(`http://localhost:3201/api/link/plants/${id}/photo`, {
        method: "POST",
        headers: {
          ...headers(),
          "if-match": String(revision),
          "content-type": type,
        },
        body: new Uint8Array(data),
      });
    assert.equal(
      (
        await upload(
          photoRequest(
            row.revision,
            Buffer.from("<svg>bad</svg>"),
            "image/png",
          ),
          context,
        )
      ).status,
      415,
    );
    assert.equal(
      (await upload(photoRequest(row.revision), context)).status,
      200,
    );
    const fetched = await getPhoto(
      request(`/api/link/plants/${id}/photo`),
      context,
    );
    assert.equal(fetched.status, 200);
    assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), bytes);
    assert.equal(
      (
        await getPhoto(
          request(`/api/link/plants/${id}/photo`, "GET", undefined, otherToken),
          context,
        )
      ).status,
      404,
    );
    assert.equal(
      (await upload(photoRequest(row.revision), context)).status,
      409,
    );
    row = (await (await list(request("/api/link/plants"))).json()).plants[0];
    assert.ok(row.photo.url.endsWith(`/plants/${id}/photo`));
    assert.equal(row.photoName, undefined);
    assert.equal(
      (
        await change(
          request("/api/link/plants", "POST", {
            ...payload,
            action: "update",
            revision: row.revision,
            name: "Монстера домашняя",
          }),
        )
      ).status,
      200,
    );
    row = (await (await list(request("/api/link/plants"))).json()).plants[0];
    assert.ok(row.photo, "Legacy text updates preserve the photo.");
    assert.equal(
      (
        await settings(
          request("/api/link/plants/settings", "PATCH", {
            timeZone: "not-a-zone",
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await settings(
          request("/api/link/plants/settings", "PATCH", {
            enabled: true,
            app: true,
            telegram: true,
            time: "00:00",
            timeZone: "UTC",
            repeatDays: 0,
          }),
        )
      ).status,
      200,
    );
    await processPlantReminders(now, true);
    let alert = await prisma.plantAlert.findFirstOrThrow({
      where: { plant: { userId: owner.id } },
    });
    assert.ok(alert.appDeliveredAt);
    assert.equal(alert.telegramDeliveredAt, null);
    const events = await prisma.linkDeviceEvent.count({
      where: { deviceId: approved.id },
    });
    assert.equal(events, 1);
    assert.equal(
      (await notificationFeed(owner.id)).items.filter(
        (event) => event.type === "plant-care",
      ).length,
      1,
    );
    assert.equal((await notificationFeed(other.id)).items.length, 0);
    await processPlantReminders(new Date(now.getTime() + 61_000), true);
    assert.equal(
      await prisma.linkDeviceEvent.count({ where: { deviceId: approved.id } }),
      events,
      "A Telegram retry must not resend to devices.",
    );
    alert = await prisma.plantAlert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    assert.equal(alert.attempts, 2);
    assert.equal(
      (
        await change(
          request("/api/link/plants", "POST", {
            action: "water",
            clientId: id,
            revision: row.revision,
            lastWateredAt: now.toISOString(),
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      await prisma.linkDeviceEvent.count({
        where: { deviceId: approved.id, deliveredAt: null },
      }),
      0,
      "Watering cancels obsolete notifications for sleeping devices.",
    );
    assert.ok(
      (await prisma.plantAlert.findUniqueOrThrow({ where: { id: alert.id } }))
        .finishedAt,
    );
    row = (await (await list(request("/api/link/plants"))).json()).plants[0];
    assert.equal(
      (
        await deletePhoto(
          new Request(`http://localhost:3201/api/link/plants/${id}/photo`, {
            method: "DELETE",
            headers: { ...headers(), "if-match": String(row.revision) },
          }),
          context,
        )
      ).status,
      200,
    );
    assert.equal(
      (await getPhoto(request(`/api/link/plants/${id}/photo`), context)).status,
      404,
    );
    await settings(
      request("/api/link/plants/settings", "PATCH", { telegram: false }),
    );
    const later = new Date(now.getTime() + 2 * 86_400_000);
    await processPlantReminders(later, true);
    const nextAlert = await prisma.plantAlert.findFirstOrThrow({
      where: { plant: { userId: owner.id }, id: { not: alert.id } },
    });
    assert.ok(nextAlert.finishedAt, "The app-only cycle was delivered.");
    await settings(
      request("/api/link/plants/settings", "PATCH", { telegram: true }),
    );
    assert.equal(
      (
        await prisma.plantAlert.findUniqueOrThrow({
          where: { id: nextAlert.id },
        })
      ).finishedAt,
      null,
      "Enabling Telegram resumes the undelivered channel of a current reminder.",
    );
    await settings(
      request("/api/link/plants/settings", "PATCH", { enabled: false }),
    );
    assert.equal(
      await prisma.linkDeviceEvent.count({
        where: { deviceId: approved.id, deliveredAt: null },
      }),
      0,
      "Disabling reminders removes queued notices.",
    );
    await prisma.linkDevice.update({
      where: { id: approved.id },
      data: { revokedAt: now },
    });
    assert.equal((await list(request("/api/link/plants"))).status, 401);
    await prisma.linkDevice.update({
      where: { id: approved.id },
      data: { revokedAt: null },
    });
    row = (await (await list(request("/api/link/plants"))).json()).plants[0];
    await upload(photoRequest(row.revision), context);
    await settings(
      request("/api/link/plants/settings", "PATCH", {
        enabled: true,
        app: true,
        telegram: false,
        repeatDays: 0,
      }),
    );
    const retentionId = randomUUID();
    await change(
      request("/api/link/plants", "POST", {
        ...payload,
        clientId: retentionId,
        name: "Retention test",
        lastWateredAt: new Date(now.getTime() - 60 * 86_400_000).toISOString(),
      }),
    );
    await processPlantReminders(now, true);
    const retained = await prisma.plantAlert.findFirstOrThrow({
      where: { plant: { clientId: retentionId }, finishedAt: { not: null } },
    });
    await prisma.plantAlert.update({
      where: { id: retained.id },
      data: { createdAt: new Date(now.getTime() - 31 * 86_400_000) },
    });
    await processPlantReminders(now, true);
    assert.ok(
      await prisma.plantAlert.findUnique({ where: { id: retained.id } }),
      "History cleanup must preserve a current one-time reminder's deduplication state.",
    );
    await change(
      request("/api/link/plants", "POST", {
        action: "delete",
        clientId: retentionId,
        revision: 1,
      }),
    );
    await processPlantReminders(now, true);
    assert.equal(
      await prisma.plantAlert.findUnique({ where: { id: retained.id } }),
      null,
      "Obsolete completed cycles can be cleaned up.",
    );
    await setSetting(`plants.notifications:${owner.id}`, {
      enabled: true,
      app: true,
      telegram: false,
      time: "09:00",
      timeZone: "Europe/Moscow",
      repeatDays: 1,
    });
    console.log(
      "PASS: private photo CRUD, revisions, permissions, settings, durable reminders, channel retries and account isolation.",
    );
    console.log(
      "Browser fixture: plant-test / local-plant-check (temporary database only).",
    );
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
