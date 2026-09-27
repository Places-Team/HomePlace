import { NextResponse } from "next/server";
import { authorizeMobile } from "@/lib/linkMobile";
import { appendUploadChunk, cancelUpload, finishUpload, uploadStatus, UPLOAD_CHUNK_BYTES } from "@/lib/linkResumableUploads";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json({ error: "invalid upload id" }, { status: 400 });
  const status = await uploadStatus(id, auth.device.id);
  return status ? NextResponse.json(status, { headers: { "cache-control": "no-store" } })
    : NextResponse.json({ error: "upload unavailable" }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json({ error: "invalid upload id" }, { status: 400 });
  const rawOffset = request.headers.get("x-upload-offset");
  const rawLength = request.headers.get("content-length");
  if (!rawOffset || !/^(0|[1-9]\d{0,10})$/.test(rawOffset) || !rawLength || !/^[1-9]\d{0,7}$/.test(rawLength)) {
    return NextResponse.json({ error: "offset and content length required" }, { status: 400 });
  }
  const length = Number(rawLength);
  if (length > UPLOAD_CHUNK_BYTES || !request.body) return NextResponse.json({ error: "chunk too large" }, { status: 413 });
  const reader = request.body.getReader();
  const parts: Buffer[] = [];
  let received = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    received += part.value.byteLength;
    if (received > length || received > UPLOAD_CHUNK_BYTES) {
      await reader.cancel().catch(() => undefined);
      return NextResponse.json({ error: "chunk too large" }, { status: 413 });
    }
    parts.push(Buffer.from(part.value));
  }
  if (received !== length) return NextResponse.json({ error: "chunk length mismatch" }, { status: 400 });
  const result = await appendUploadChunk(id, auth.device.id, Number(rawOffset), Buffer.concat(parts));
  return "error" in result ? NextResponse.json(result, { status: result.status }) : NextResponse.json(result);
}

export async function POST(request: Request, context: Context) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json({ error: "invalid upload id" }, { status: 400 });
  try {
    const result = await finishUpload(id, auth.device);
    return "error" in result ? NextResponse.json(result, { status: result.status }) : NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("resumable upload finalization failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "could not finalize upload; retry later" }, { status: 503 });
  }
}

function validId(value: string) { return /^[A-Za-z0-9_-]{1,40}$/.test(value); }

export async function DELETE(request: Request, context: Context) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json({ error: "invalid upload id" }, { status: 400 });
  return await cancelUpload(id, auth.device.id) ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "upload unavailable" }, { status: 404 });
}
