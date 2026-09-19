"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import {
  approveLinkPairing,
  queueTestNotification,
  rejectLinkPairing,
  revokeLinkDevice,
} from "@/lib/linkDevices";

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
