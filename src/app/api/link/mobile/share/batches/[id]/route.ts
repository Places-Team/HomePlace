import { NextResponse } from "next/server";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { getBatch, changeBatch } from "@/lib/linkBatches";
import { validDeviceId } from "@/lib/linkShare";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = validDeviceId((await context.params).id);
  const batch = id ? await getBatch(id, auth.device) : null;
  return NextResponse.json(batch ? { batch } : { error: "batch unavailable" }, { status: batch ? 200 : 404, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: Context) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!checkDeviceActionRateLimit(auth.device.id, "batch-actions", 120).allowed) return NextResponse.json({ error: "too many actions" }, { status: 429 });
  const id = validDeviceId((await context.params).id);
  const body = await boundedJson(request);
  if (!id || !body || typeof body !== "object") return NextResponse.json({ error: "invalid action" }, { status: 400 });
  const changed = await changeBatch(id, auth.device, body as Record<string, unknown>);
  return NextResponse.json(changed ? { batch: await getBatch(id, auth.device) } : { error: "batch unavailable or invalid state/receipt" }, { status: changed ? 200 : 409 });
}
