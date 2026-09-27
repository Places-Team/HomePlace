import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateLinkDevice, linkDeviceHasCapability } from "@/lib/linkDevices";
import { parseLinkNotificationPayload } from "@/lib/linkNotificationQueue";

export const dynamic = "force-dynamic";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_PAGE_SIZE = 100;

/** Delivered Link notifications for this device only, newest first. */
export async function GET(request: Request) {
  const device = await authenticateLinkDevice(request);
  if (!device) return NextResponse.json({ error: "invalid device credential" }, { status: 401 });
  if (!device.userId || !linkDeviceHasCapability(device, "notification.receive")) {
    return NextResponse.json({ error: "notification access is not available" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor");
  const rawLimit = params.get("limit");
  if (cursor && !CURSOR_PATTERN.test(cursor)) {
    return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
  }
  if (rawLimit !== null && !/^[1-9][0-9]{0,2}$/.test(rawLimit)) {
    return NextResponse.json({ error: "invalid limit" }, { status: 400 });
  }
  const limit = rawLimit === null ? 50 : Math.min(Number(rawLimit), MAX_PAGE_SIZE);
  const where = {
    deviceId: device.id,
    kind: "notification.deliver",
    deliveredAt: { not: null },
  } as const;

  if (cursor) {
    const anchor = await prisma.linkDeviceEvent.findFirst({ where: { ...where, id: cursor }, select: { id: true } });
    if (!anchor) return NextResponse.json({ error: "notification page not found" }, { status: 404 });
  }

  const rows = await prisma.linkDeviceEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, payload: true, createdAt: true, deliveredAt: true },
  });

  return NextResponse.json(
    {
      notifications: rows.slice(0, limit).flatMap((row) => {
        const message = parseLinkNotificationPayload(row.payload);
        return message
          ? [{ id: row.id, ...message, createdAt: row.createdAt.toISOString(), deliveredAt: row.deliveredAt?.toISOString() }]
          : [];
      }),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
