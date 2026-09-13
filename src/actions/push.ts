"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { publicKey, sendPush } from "@/lib/push";

/** Subscribing this browser, and proving it works. */

export async function pushPublicKey(): Promise<string> {
  await requireUser();
  return publicKey();
}

export async function subscribePush(input: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
  const user = await requireUser();
  const requestHeaders = await headers();
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    // The endpoint is the identity, so re-subscribing on the same browser
    // updates the row rather than filling the table with duplicates.
    update: { userId: user.id, p256dh: input.p256dh, auth: input.auth },
    create: {
      endpoint: input.endpoint,
      userId: user.id,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: requestHeaders.get("user-agent")?.slice(0, 200) ?? null,
    },
  });
  revalidatePath("/settings");
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const user = await requireUser();
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  revalidatePath("/settings");
}

export async function testPush(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const result = await sendPush([user.id], {
    title: "HomePlace",
    body: "Test notification — push is working.",
    url: "/",
  });
  if (result.sent === 0) return { ok: false, error: "no subscription on this account yet" };
  return { ok: true };
}

/** How many browsers this account has subscribed. */
export async function pushSubscriptionCount(): Promise<number> {
  const user = await requireUser();
  return prisma.pushSubscription.count({ where: { userId: user.id } });
}
