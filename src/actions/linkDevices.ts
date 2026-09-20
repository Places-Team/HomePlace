"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import {
  approveLinkPairing,
  queueDashboardShare,
  queueTestNotification,
  rejectLinkPairing,
  revokeLinkDevice,
} from "@/lib/linkDevices";
import { parseShareMessage } from "@/lib/linkShare";

export async function approvePairing(id: string): Promise<void> {
  const user = await requireRole("admin");
  await approveLinkPairing(id, user.id);
  revalidatePath("/devices");
}

export async function rejectPairing(id: string): Promise<void> {
  await requireRole("admin");
  await rejectLinkPairing(id);
  revalidatePath("/devices");
}

export async function revokeDevice(id: string): Promise<void> {
  await requireRole("admin");
  await revokeLinkDevice(id);
  revalidatePath("/devices");
}

export async function sendDeviceTestNotification(id: string): Promise<void> {
  await requireRole("admin");
  await queueTestNotification(id);
  revalidatePath("/devices");
}

export async function sendDeviceShare(
  id: string,
  type: "text" | "url",
  value: string,
): Promise<{ ok: boolean; error?: "invalid" | "unavailable" | "unsupported" | "full" }> {
  await requireRole("admin");
  const message = parseShareMessage({ targetDeviceId: id, type, value });
  if (!message) return { ok: false, error: "invalid" };
  const result = await queueDashboardShare(
    message.targetDeviceId,
    message.type,
    message.value,
  );
  if (result !== "queued") return { ok: false, error: result };
  revalidatePath("/devices");
  return { ok: true };
}
