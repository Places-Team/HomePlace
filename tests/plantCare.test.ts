import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePlantSettings,
  plantReminderSlot,
  plantWateringState,
} from "../src/lib/plantCare";
import {
  plantPhotoType,
  readPlantPhotoBody,
  MAX_PLANT_PHOTO_BYTES,
} from "../src/lib/plantPhoto";

const plant = {
  intervalDays: 2,
  lastWateredAt: new Date("2026-10-01T20:00:00Z"),
  remindersEnabled: true,
  deletedAt: null,
};
const settings = normalizePlantSettings({
  timeZone: "Europe/Moscow",
  time: "09:00",
  repeatDays: 1,
});
test("watering status exposes the local due date and overdue days", () => {
  assert.deepEqual(
    plantWateringState(
      plant,
      "Europe/Moscow",
      new Date("2026-10-04T06:00:00Z"),
    ),
    { dueDate: "2026-10-03", daysUntil: -1 },
  );
});

test("watering reminders use the account's calendar days and chosen time", () => {
  assert.equal(
    plantReminderSlot(plant, settings, new Date("2026-10-03T05:59:59Z")),
    null,
  );
  assert.equal(
    plantReminderSlot(plant, settings, new Date("2026-10-03T06:00:00Z")),
    "2026-10-03",
  );
});
test("disabled and deleted plants do not produce reminders", () => {
  const now = new Date("2026-10-04T06:00:00Z");
  assert.equal(
    plantReminderSlot({ ...plant, remindersEnabled: false }, settings, now),
    null,
  );
  assert.equal(
    plantReminderSlot({ ...plant, deletedAt: now }, settings, now),
    null,
  );
  assert.equal(
    plantReminderSlot(plant, { ...settings, enabled: false }, now),
    null,
  );
});
test("a two-day repeat keeps its original due date and catches up after downtime", () => {
  const repeating = { ...settings, repeatDays: 2 };
  assert.equal(
    plantReminderSlot(plant, repeating, new Date("2026-10-04T10:00:00Z")),
    "2026-10-03",
  );
  assert.equal(
    plantReminderSlot(plant, repeating, new Date("2026-10-05T05:00:00Z")),
    "2026-10-03",
  );
  assert.equal(
    plantReminderSlot(plant, repeating, new Date("2026-10-05T06:00:00Z")),
    "2026-10-05",
  );
});
test("one-time reminders retain one slot until the plant is watered", () => {
  assert.equal(
    plantReminderSlot(
      plant,
      { ...settings, repeatDays: 0 },
      new Date("2026-10-10T06:00:00Z"),
    ),
    "2026-10-03",
  );
  assert.equal(
    plantReminderSlot(
      { ...plant, lastWateredAt: new Date("2026-10-10T05:00:00Z") },
      settings,
      new Date("2026-10-10T06:00:00Z"),
    ),
    null,
  );
});
test("calendar-day schedules survive daylight-saving changes", () => {
  const berlin = normalizePlantSettings({
    timeZone: "Europe/Berlin",
    time: "09:00",
  });
  const dstPlant = {
    ...plant,
    intervalDays: 1,
    lastWateredAt: new Date("2026-10-24T07:00:00Z"),
  };
  assert.equal(
    plantReminderSlot(dstPlant, berlin, new Date("2026-10-25T07:59:59Z")),
    null,
  );
  assert.equal(
    plantReminderSlot(dstPlant, berlin, new Date("2026-10-25T08:00:00Z")),
    "2026-10-25",
  );
});
test("invalid stored settings fall back to usable bounded defaults", () => {
  const value = normalizePlantSettings({
    timeZone: "invalid",
    time: "26:00",
    repeatDays: 99,
    telegram: "yes",
  });
  assert.equal(value.timeZone, "UTC");
  assert.equal(value.time, "09:00");
  assert.equal(value.repeatDays, 1);
  assert.equal(value.telegram, false);
});
test("plant photos identify JPEG, PNG and WebP from bytes, not a declared MIME type", () => {
  assert.equal(
    plantPhotoType(Buffer.from([255, 216, 255, 224, 0, 1, 2, 3, 4, 5, 6, 7]))
      ?.type,
    "image/jpeg",
  );
  assert.equal(
    plantPhotoType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]))
      ?.type,
    "image/png",
  );
  assert.equal(
    plantPhotoType(Buffer.from("RIFF1234WEBPVP8 "))?.type,
    "image/webp",
  );
  assert.equal(plantPhotoType(Buffer.from("<svg>evil</svg>")), null);
  assert.equal(plantPhotoType(Buffer.from("not a photo at all")), null);
});
test("photo upload bounds the actual streamed body even without content-length", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PLANT_PHOTO_BYTES + 1));
      controller.close();
    },
  });
  const request = new Request("http://localhost/photo", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(readPlantPhotoBody(request), /too large/);
});
test("small photo bodies are preserved and empty uploads are rejected", async () => {
  assert.deepEqual(
    await readPlantPhotoBody(
      new Request("http://localhost/photo", { method: "POST", body: "photo" }),
    ),
    Buffer.from("photo"),
  );
  await assert.rejects(
    readPlantPhotoBody(
      new Request("http://localhost/photo", { method: "POST" }),
    ),
    /empty/,
  );
});
