import "server-only";
import { prisma } from "./db";
import { notify } from "./notify";
import { nextOccurrence } from "./recurrence";

/**
 * Reminders that have come due.
 *
 * Checked on the same tick as everything else. Quiet hours are deliberately
 * *not* applied here: a reminder is something the person asked for at a
 * specific time, unlike an alert that the server decided to raise.
 */
export async function processReminders(): Promise<void> {
  const now = new Date();

  const due = await prisma.reminder.findMany({
    where: { done: false, at: { lte: now }, notifiedAt: null },
    take: 20,
  });
  if (due.length === 0) return;

  for (const reminder of due) {
    // A one-off is marked notified and stays put until it is ticked off. A
    // repeating one moves itself to its next time right away — "water the
    // plants every two days" should keep coming back on its own, without
    // anyone having to press done for the cycle to continue.
    if (reminder.repeat === "none") {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { notifiedAt: now } });
    } else {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { at: nextOccurrence(reminder.at, reminder.repeat), notifiedAt: null },
      });
    }

    await prisma.event.create({
      data: { userId: reminder.userId, type: "system", severity: "info", title: reminder.title, detail: "reminder" },
    });

    // Browser and Link notifications go only to the reminder's owner.
    // Quiet hours do not apply to the time that person chose.
    await notify({
      title: `⏰ ${reminder.title}`,
      body: reminder.at.toLocaleString(),
      severity: "info",
      tag: `reminder-${reminder.id}`,
      respectQuietHours: false,
      recipientUserIds: [reminder.userId],
    });
  }
}
