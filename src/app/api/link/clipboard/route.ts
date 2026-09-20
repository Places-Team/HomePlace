import { NextResponse } from "next/server";
import {
  authenticateLinkDevice,
  linkDeviceHasCapability,
  relayClipboard,
} from "@/lib/linkDevices";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { MAX_SHARE_TEXT } from "@/lib/linkShare";

export async function POST(request: Request) {
  const device = await authenticateLinkDevice(request);
  if (!device) return NextResponse.json({ error: "invalid device credential" }, { status: 401 });
  if (!linkDeviceHasCapability(device, "clipboard.send")) {
    return NextResponse.json({ error: "clipboard sending is unavailable" }, { status: 403 });
  }
  const rate = checkDeviceActionRateLimit(device.id, "clipboard-sync", 120);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "too many clipboard updates" },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } },
    );
  }
  const body = await boundedJson(request);
  const text = body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
    ? (body as { text: string }).text
    : "";
  if (!text || text.length > MAX_SHARE_TEXT || text.includes("\0")) {
    return NextResponse.json({ error: "invalid clipboard content" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, delivered: await relayClipboard(device, text) });
}
