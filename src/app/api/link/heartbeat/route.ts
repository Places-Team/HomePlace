import { NextResponse } from "next/server";
import { authenticateLinkDevice, heartbeatLinkDevice } from "@/lib/linkDevices";
import { boundedJson } from "@/lib/linkRequest";
import { parseLinkCapabilities } from "@/lib/linkProtocol";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const device = await authenticateLinkDevice(request);
  if (!device) return NextResponse.json({ error: "invalid device credential" }, { status: 401 });
  const body = await boundedJson(request);
  if (!body || typeof body !== "object" || (body as { protocol?: unknown }).protocol !== 1) {
    return NextResponse.json({ error: "invalid heartbeat" }, { status: 400 });
  }
  const rawAcknowledged = (body as { acknowledgedEventIds?: unknown }).acknowledgedEventIds;
  const acknowledged = Array.isArray(rawAcknowledged)
    ? rawAcknowledged.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id)).slice(0, 100)
    : [];
  const rawCapabilities = (body as { capabilities?: unknown }).capabilities;
  let capabilities;
  if (rawCapabilities !== undefined) {
    const parsed = parseLinkCapabilities(rawCapabilities);
    if (!parsed) return NextResponse.json({ error: "invalid capabilities" }, { status: 400 });
    capabilities = parsed;
  }
  return NextResponse.json(await heartbeatLinkDevice(device.id, acknowledged, capabilities), {
    headers: { "cache-control": "no-store" },
  });
}
