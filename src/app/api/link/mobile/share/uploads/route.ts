import { NextResponse } from "next/server";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { beginUpload } from "@/lib/linkResumableUploads";
import { validDeviceId } from "@/lib/linkShare";

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.device.id, "resumable-upload", 10);
  if (!rate.allowed) return NextResponse.json({ error: "too many uploads" }, { status: 429 });
  const body = await boundedJson(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid upload" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const targetDeviceId = validDeviceId(input.targetDeviceId);
  if (!targetDeviceId || typeof input.filename !== "string" || typeof input.mimeType !== "string" || typeof input.size !== "number") {
    return NextResponse.json({ error: "invalid upload" }, { status: 400 });
  }
  const result = await beginUpload({
    source: auth.device, targetDeviceId, filename: input.filename,
    mimeType: input.mimeType, size: input.size,
  });
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
