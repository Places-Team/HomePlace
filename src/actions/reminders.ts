"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { nextOccurrence, isRepeat } from "@/lib/recurrence";

/**
 * Reminders.
 *
 * Personal: each account sees and edits its own. A panel on the kitchen screen
 * is exactly where "bins out on Tuesday" belongs, and exactly where somebody
 * else's work reminders do not.
 */

export async function listReminders(limit = 20) {
  const user = await requireUser();
  return prisma.reminder.findMany({
    where: { userId: user.id, done: false },
    orderBy: { at: "asc" },
    take: limit,
  });
}

export async function addReminder(input: { title: string; at: string; repeat: string }): Promise<void> {
  const user = await requireUser();
  const at = new Date(input.at);
  if (!input.title.trim() || Number.isNaN(at.getTime())) return;

  await prisma.reminder.create({
    data: {
      userId: user.id,
      title: input.title.trim().slice(0, 200),
      at,
      repeat: isRepeat(input.repeat) ? input.repeat : "none",
    },
  });
  revalidatePath("/");
}

/**
 * Tick one off.
 *
 * A repeating reminder is not finished when it is done — it moves to its next
 * occurrence, which is the whole reason it repeats.
 */
export async function completeReminder(id: string): Promise<void> {
  const user = await requireUser();
  const reminder = await prisma.reminder.findFirst({ where: { id, userId: user.id } });
  if (!reminder) return;

  if (reminder.repeat === "none") {
    await prisma.reminder.update({ where: { id }, data: { done: true, completedAt: new Date() } });
  } else {
    await prisma.reminder.update({
      where: { id },
      data: { at: nextOccurrence(reminder.at, reminder.repeat), notifiedAt: null },
    });
  }
  revalidatePath("/");
}

export async function deleteReminder(id: string): Promise<void> {
  const user = await requireUser();
  await prisma.reminder.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/");
}
