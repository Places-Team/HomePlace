import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { canEdit } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { appUrl, settings } from "@/lib/config";
import { isSameOriginRequest } from "@/lib/security";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { linkDeviceHasCapability } from "@/lib/linkDevices";
import { validDeviceId } from "@/lib/linkShare";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["system.lock", "system.sleep"]);
const COMMAND_TTL_MS = 5 * 60_000;

export async function GET() {
  const user = await currentUser();
  if (!canEdit(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const now = new Date();
  await prisma.linkCommand.updateMany({
    where: { userId: user!.id, status: "pending", expiresAt: { lte: now } },
    data: { status: "expired", completedAt: now },
  });
  const commands = await prisma.linkCommand.findMany({
    where: { userId: user!.id }, orderBy: { createdAt: "desc" }, take: 50,
    select: { id: true, deviceId: true, action: true, status: true, message: true, createdAt: true, completedAt: true, expiresAt: true },
  });
  return NextResponse.json({ commands }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!canEdit(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isSameOriginRequest(request.headers, appUrl(), settings.trustProxyHeaders())) {
    return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
  }
  const body = await boundedJson(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid command" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const deviceId = validDeviceId(input.deviceId);
  const action = typeof input.action === "string" && ACTIONS.has(input.action) ? input.action : null;
  if (!deviceId || !action) return NextResponse.json({ error: "unsupported command" }, { status: 400 });
  const rate = checkDeviceActionRateLimit(user!.id, "link-command", 10);
  if (!rate.allowed) return NextResponse.json({ error: "too many commands" }, {
    status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) },
  });
  const device = await prisma.linkDevice.findFirst({
    where: { id: deviceId, userId: user!.id, revokedAt: null },
    select: { id: true, capabilities: true },
  });
  if (!device || !linkDeviceHasCapability(device, action)) {
    return NextResponse.json({ error: "device does not support this command" }, { status: 404 });
  }
  const expiresAt = new Date(Date.now() + COMMAND_TTL_MS);
  const command = await prisma.$transaction(async (tx) => {
    const pending = await tx.linkCommand.count({ where: { deviceId, status: "pending", expiresAt: { gt: new Date() } } });
    if (pending >= 5) return null;
    const created = await tx.linkCommand.create({ data: { userId: user!.id, deviceId, action, expiresAt } });
    await tx.linkDeviceEvent.create({
      data: { deviceId, kind: "command.execute", payload: JSON.stringify({ commandId: created.id, action, expiresAt: expiresAt.toISOString() }) },
    });
    return created;
  });
  if (!command) return NextResponse.json({ error: "device command queue is full" }, { status: 429 });
  return NextResponse.json({ id: command.id, status: command.status, expiresAt }, { status: 202 });
}
