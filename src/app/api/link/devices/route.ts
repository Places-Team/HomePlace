import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateLinkDevice } from "@/lib/linkDevices";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = await authenticateLinkDevice(request);
  if (!current) return NextResponse.json({ error: "invalid device credential" }, { status: 401 });
  if (!current.userId) return NextResponse.json({ error: "device is not assigned to an account" }, { status: 403 });

  const devices = await prisma.linkDevice.findMany({
    where: { userId: current.userId, revokedAt: null },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      platform: true,
      platformVersion: true,
      appVersion: true,
      lastSeenAt: true,
      user: { select: { name: true } },
    },
  });

  const onlineAfter = Date.now() - 90_000;
  const uniqueDevices = new Map<string, (typeof devices)[number]>();
  for (const device of devices) {
    const key = `${device.platform.toLowerCase()}\u0000${device.name.toLowerCase()}`;
    if (!uniqueDevices.has(key) || device.id === current.id) uniqueDevices.set(key, device);
  }
  return NextResponse.json({
    devices: [...uniqueDevices.values()].map((device) => ({
      id: device.id,
      name: device.name,
      platform: device.platform,
      platformVersion: device.platformVersion,
      appVersion: device.appVersion,
      online: device.lastSeenAt !== null && device.lastSeenAt.getTime() > onlineAfter,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      ownerName: device.user?.name ?? "HomePlace user",
      currentDevice: device.id === current.id,
    })),
  });
}
