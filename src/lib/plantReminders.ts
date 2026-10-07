import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./db";
import { plantReminderSlot, plantReminderMessage } from "./plantCare";
import { plantSettings, plantReminderTag } from "./plants";
import { notify, type Notification } from "./notify";

let lastRun = 0;
let lastCleanup = 0;
const scheduler = globalThis as typeof globalThis & {
  homeplacePlantTimer?: ReturnType<typeof setInterval>;
  homeplacePlantRunning?: boolean;
};

/** Personal reminders run independently of infrastructure monitoring. */
export function startPlantReminderScheduler() {
  if (scheduler.homeplacePlantTimer) return;
  const run = async () => {
    if (scheduler.homeplacePlantRunning) return;
    scheduler.homeplacePlantRunning = true;
    try { await processPlantReminders(); }
    catch (error) { console.error("plant reminders failed:", error); }
    finally { scheduler.homeplacePlantRunning = false; }
  };
  scheduler.homeplacePlantTimer = setInterval(() => void run(), 60_000);
  console.log("plant reminder scheduler started");
  setTimeout(() => void run(), 5000);
}

/** Durable per-plant cycle markers, delivered as one account digest per channel. */
export async function processPlantReminders(now = new Date(), force = false): Promise<void> {
  if (!force && now.getTime() - lastRun < 60_000) return;
  lastRun = now.getTime();
  const plants = await prisma.plant.findMany({
    where: { deletedAt: null, remindersEnabled: true, user: { disabled: false } },
  });
  const settingsByUser = new Map<string, Awaited<ReturnType<typeof plantSettings>>>();
  const settingsFor = async (userId: string) => {
    let settings = settingsByUser.get(userId);
    if (!settings) {
      settings = await plantSettings(userId);
      settingsByUser.set(userId, settings);
    }
    return settings;
  };
  for (const plant of plants) {
    const cycle = plantReminderSlot(plant, await settingsFor(plant.userId), now);
    if (!cycle) continue;
    const id = createHash("sha256").update(`${plant.id}:${plant.lastWateredAt.toISOString()}:${plant.intervalDays}:${cycle}`).digest("hex");
    if (!(await prisma.plantAlert.findUnique({ where: { id }, select: { id: true } }))) {
      await prisma.plantAlert.upsert({
        where: { id },
        create: { id, plantId: plant.id, cycle, wateringAt: plant.lastWateredAt, nextAttemptAt: now },
        update: {},
      });
    }
  }
  const pending = await prisma.plantAlert.findMany({
    where: { finishedAt: null, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    include: { plant: { include: { user: { select: { locale: true, disabled: true } } } } },
  });
  const groups = new Map<string, typeof pending>();
  for (const alert of pending) {
    const { plant } = alert;
    const settings = await settingsFor(plant.userId);
    if (plant.user.disabled || alert.wateringAt.getTime() !== plant.lastWateredAt.getTime()
      || plantReminderSlot(plant, settings, now) !== alert.cycle
      || now.getTime() - alert.createdAt.getTime() > 7 * 86_400_000) {
      await prisma.plantAlert.updateMany({ where: { id: alert.id, finishedAt: null }, data: { finishedAt: now } });
      continue;
    }
    const group = groups.get(plant.userId) ?? [];
    group.push(alert);
    groups.set(plant.userId, group);
  }
  for (const [userId, alerts] of groups) {
    // Claim all rows together so concurrent workers cannot split an account digest.
    const claimed = await prisma.$transaction(async (tx) => {
      const current = await tx.plantAlert.findMany({ where: { id: { in: alerts.map((a) => a.id) }, finishedAt: null } });
      if (current.length !== alerts.length || current.some((a) => a.nextAttemptAt > now)) return false;
      await tx.plantAlert.updateMany({
        where: { id: { in: alerts.map((a) => a.id) } },
        data: { nextAttemptAt: new Date(now.getTime() + 120_000) },
      });
      return true;
    });
    if (!claimed) continue;
    const settings = await settingsFor(userId);
    const locale = alerts[0].plant.user.locale;
    const appAlerts = settings.app ? alerts.filter((a) => !a.appDeliveredAt) : [];
    const telegramAlerts = settings.telegram ? alerts.filter((a) => !a.telegramDeliveredAt) : [];
    const digestId = (rows: typeof alerts) => `plant-care-${createHash("sha256").update(rows.map((a) => a.id).sort().join(":")).digest("hex")}`;
    if (appAlerts.length) {
      const eventId = digestId(appAlerts);
      const message = plantReminderMessage(appAlerts.map((a) => a.plant), locale);
      await prisma.event.upsert({
        where: { id: eventId },
        create: { id: eventId, userId, type: "plant-care", severity: "info", title: message.title, detail: message.body },
        update: {},
      });
      await prisma.plantAlert.updateMany({ where: { id: { in: appAlerts.map((a) => a.id) } }, data: { eventId } });
    }
    const deliver = async (rows: typeof alerts, channels: NonNullable<Notification["channels"]>) => rows.length
      ? notify({
        ...plantReminderMessage(rows.map((a) => a.plant), locale),
        tag: plantReminderTag(userId), recipientUserIds: [userId], respectQuietHours: false, channels,
      }) : null;
    const appDelivery = await deliver(appAlerts, ["push", "link"]);
    const telegramDelivery = await deliver(telegramAlerts, ["telegram"]);
    for (const alert of alerts) {
      const appDeliveredAt = alert.appDeliveredAt ?? (appDelivery && (appDelivery.push > 0 || appDelivery.link > 0) ? now : null);
      const telegramDeliveredAt = alert.telegramDeliveredAt ?? (telegramDelivery?.telegram ? now : null);
      const finished = (!settings.app || appDeliveredAt !== null) && (!settings.telegram || telegramDeliveredAt !== null);
      const attempts = alert.attempts + 1;
      await prisma.plantAlert.updateMany({
        where: { id: alert.id, finishedAt: null },
        data: {
          appDeliveredAt, telegramDeliveredAt, attempts, finishedAt: finished ? now : null,
          nextAttemptAt: new Date(now.getTime() + Math.min(3600, 60 * 2 ** Math.min(attempts - 1, 6)) * 1000),
          lastError: finished ? null : settings.telegram && !telegramDeliveredAt
            ? "Telegram delivery pending; check Telegram integration."
            : "Waiting for receiving device or browser push subscription.",
        },
      });
    }
  }
  if (force || now.getTime() - lastCleanup >= 86_400_000) {
    lastCleanup = now.getTime();
    // Preserve current-cycle deduplication markers for once-only reminders.
    const expired = await prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM PlantAlert a JOIN Plant p ON a.plantId = p.id
      WHERE a.finishedAt IS NOT NULL AND a.createdAt < ${new Date(now.getTime() - 30 * 86_400_000)}
      AND (p.deletedAt IS NOT NULL OR a.wateringAt <> p.lastWateredAt) LIMIT 200
    `;
    if (expired.length) await prisma.plantAlert.deleteMany({ where: { id: { in: expired.map((row) => row.id) } } });
  }
}
