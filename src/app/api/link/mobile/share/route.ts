import { NextResponse } from "next/server";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { parseShareMessage } from "@/lib/linkShare";
import { queueShareOffer, resolveShareTarget, shareTargets } from "@/lib/linkDevices";

export async function GET(request: Request) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(
    { targets: await shareTargets(auth.device) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.device.id, "share", 20);
  if (!rate.allowed) return NextResponse.json(
    { error: "too many share requests" },
    { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } },
  );
  const message = parseShareMessage(await boundedJson(request));
  if (!message) return NextResponse.json({ error: "invalid shared content" }, { status: 400 });
  const target = await resolveShareTarget(auth.device, message.targetDeviceId, message.type);
  if (!target) return NextResponse.json({ error: "target device is unavailable" }, { status: 404 });
  const queued = await queueShareOffer(target.id, { type: message.type, value: message.value, sourceName: auth.device.name });
  if (!queued) return NextResponse.json({ error: "target device has too many pending offers" }, { status: 429 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
