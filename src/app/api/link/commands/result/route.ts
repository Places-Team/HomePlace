import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateLinkDevice } from "@/lib/linkDevices";
import { boundedJson } from "@/lib/linkRequest";

export async function POST(request: Request) {
  const device = await authenticateLinkDevice(request);
  if (!device) return NextResponse.json({ error: "invalid device credential" }, { status: 401 });
  const body = await boundedJson(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid result" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.commandId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(input.commandId)
    || (input.status !== "succeeded" && input.status !== "failed")) {
    return NextResponse.json({ error: "invalid result" }, { status: 400 });
  }
  const message = typeof input.message === "string" ? input.message.slice(0, 300) : null;
  const now = new Date();
  const updated = await prisma.linkCommand.updateMany({
    where: { id: input.commandId, deviceId: device.id, status: "pending", expiresAt: { gt: now } },
    data: { status: input.status, message, completedAt: now },
  });
  if (!updated.count) return NextResponse.json({ error: "command is missing or expired" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
