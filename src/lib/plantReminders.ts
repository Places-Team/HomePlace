import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./db";
import { plantReminderSlot } from "./plantCare";
import { plantSettings } from "./plants";
import { notify, type Notification } from "./notify";

let lastRun = 0;
let lastCleanup = 0;
const scheduler = globalThis as typeof globalThis & {
  homeplacePlantTimer?: ReturnType<typeof setInterval>;
  homeplacePlantRunning?: boolean;
};
/** Keep personal reminders running even when infrastructure monitoring is disabled. */
export function startPlantReminderScheduler() {
  if (scheduler.homeplacePlantTimer) return;
  const run = async () => {
    if (scheduler.homeplacePlantRunning) return;
    scheduler.homeplacePlantRunning = true;
    try {
      await processPlantReminders();
    } catch (error) {
      console.error("plant reminders failed:", error);
    } finally {
      scheduler.homeplacePlantRunning = false;
    }
  };
  scheduler.homeplacePlantTimer = setInterval(() => void run(), 60_000);
  console.log("plant reminder scheduler started");
  setTimeout(() => void run(), 5000);
}
/** Calendar reminders run once a minute; durable rows deduplicate across bundles. */
export async function processPlantReminders(
  now = new Date(),
  force = false,
): Promise<void> {
  if (!force && now.getTime() - lastRun < 60_000) return;
  lastRun = now.getTime();
  const plants = await prisma.plant.findMany({
    where: {
      deletedAt: null,
      remindersEnabled: true,
      user: { disabled: false },
    },
    include: { user: { select: { locale: true } } },
  });
  const settingsByUser = new Map<
    string,
    Awaited<ReturnType<typeof plantSettings>>
  >();
  for (const plant of plants) {
    let settings = settingsByUser.get(plant.userId);
    if (!settings) {
      settings = await plantSettings(plant.userId);
      settingsByUser.set(plant.userId, settings);
    }
    const cycle = plantReminderSlot(plant, settings, now);
    if (!cycle) continue;
    const id = createHash("sha256")
      .update(
        `${plant.id}:${plant.lastWateredAt.toISOString()}:${plant.intervalDays}:${cycle}`,
      )
      .digest("hex");
    // Existing slots are read without writes, keeping idle monitoring inexpensive.
    if (
      !(await prisma.plantAlert.findUnique({
        where: { id },
        select: { id: true },
      }))
    ) {
      await prisma.plantAlert.upsert({
        where: { id },
        create: {
          id,
          plantId: plant.id,
          cycle,
          wateringAt: plant.lastWateredAt,
          nextAttemptAt: now,
        },
        update: {},
      });
    }
  }
  const pending = await prisma.plantAlert.findMany({
    where: { finishedAt: null, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: 20,
  });
  for (const alert of pending) {
    const lease = await prisma.plantAlert.updateMany({
      where: { id: alert.id, finishedAt: null, nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + 120_000) },
    });
    if (!lease.count) continue;
    const plant = await prisma.plant.findUnique({
      where: { id: alert.plantId },
      include: { user: { select: { locale: true, disabled: true } } },
    });
    if (!plant) continue;
    const settings = await plantSettings(plant.userId);
    if (
      plant.user.disabled ||
      alert.wateringAt.getTime() !== plant.lastWateredAt.getTime() ||
      plantReminderSlot(plant, settings, now) !== alert.cycle ||
      now.getTime() - alert.createdAt.getTime() > 7 * 86_400_000
    ) {
      await prisma.plantAlert.update({
        where: { id: alert.id },
        data: { finishedAt: now },
      });
      continue;
    }
    const ru = plant.user.locale === "ru";
    const title = ru
      ? `Пора полить: ${plant.name}`
      : `Time to water: ${plant.name}`;
    const body = ru
      ? `${plant.location ? `${plant.location}. ` : ""}Полив каждые ${plant.intervalDays} дн. Отметьте полив в HomePlace.`
      : `${plant.location ? `${plant.location}. ` : ""}Water every ${plant.intervalDays} days. Mark watered in HomePlace.`;
    const channels: NonNullable<Notification["channels"]> = [];
    if (settings.app && !alert.appDeliveredAt) channels.push("push", "link");
    if (settings.telegram && !alert.telegramDeliveredAt)
      channels.push("telegram");
    const eventId = alert.eventId ?? `plant-care-${alert.id}`;
    if (settings.app && !alert.eventId) {
      await prisma.event.upsert({
        where: { id: eventId },
        create: {
          id: eventId,
          userId: plant.userId,
          type: "plant-care",
          severity: "info",
          title,
          detail: body,
          actor: plant.clientId,
        },
        update: {},
      });
      await prisma.plantAlert.update({
        where: { id: alert.id },
        data: { eventId },
      });
    }
    const delivery = channels.length
      ? await notify({
          title,
          body,
          url: `/plants?plant=${plant.clientId}`,
          tag: `plant-${plant.clientId}`,
          recipientUserIds: [plant.userId],
          respectQuietHours: false,
          channels,
        })
      : null;
    const appDeliveredAt =
      alert.appDeliveredAt ??
      (delivery && (delivery.push > 0 || delivery.link > 0) ? now : null);
    const telegramDeliveredAt =
      alert.telegramDeliveredAt ?? (delivery?.telegram ? now : null);
    const finished =
      (!settings.app || appDeliveredAt !== null) &&
      (!settings.telegram || telegramDeliveredAt !== null);
    const attempts = alert.attempts + 1;
    await prisma.plantAlert.update({
      where: { id: alert.id },
      data: {
        appDeliveredAt,
        telegramDeliveredAt,
        attempts,
        finishedAt: finished ? now : null,
        nextAttemptAt: new Date(
          now.getTime() +
            Math.min(3600, 60 * 2 ** Math.min(attempts - 1, 6)) * 1000,
        ),
        lastError: finished
          ? null
          : settings.telegram && !telegramDeliveredAt
            ? "Telegram delivery pending; check the Telegram integration."
            : "Waiting for a receiving device or browser push subscription.",
      },
    });
  }
  if (force || now.getTime() - lastCleanup >= 86_400_000) {
    lastCleanup = now.getTime();
    // Keep current watering-cycle markers: deleting one would resend a
    // one-time reminder after thirty days without a new watering action.
    const expired = await prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM PlantAlert a JOIN Plant p ON a.plantId = p.id
      WHERE a.finishedAt IS NOT NULL AND a.createdAt < ${new Date(now.getTime() - 30 * 86_400_000)}
      AND (p.deletedAt IS NOT NULL OR a.wateringAt <> p.lastWateredAt) LIMIT 200
    `;
    if (expired.length)
      await prisma.plantAlert.deleteMany({
        where: { id: { in: expired.map((row) => row.id) } },
      });
  }
}
