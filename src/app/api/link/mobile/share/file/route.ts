import { NextResponse } from "next/server";
import { authorizeMobile } from "@/lib/linkMobile";
import { createFileTransfer, discardFileTransfer } from "@/lib/linkFiles";
import { MAX_SHARE_FILE_BYTES, safeFilename, validDeviceId } from "@/lib/linkShare";
import { queueShareOffer, resolveShareTarget } from "@/lib/linkDevices";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.device.id, "share-file", 10);
  if (!rate.allowed) return NextResponse.json(
    { error: "too many file requests" },
    { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } },
  );
  const targetDeviceId = validDeviceId(request.headers.get("x-homeplace-target"));
  const filename = safeFilename(decodeFilename(request.headers));
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (!targetDeviceId || !Number.isSafeInteger(announced) || announced < 1 || announced > MAX_SHARE_FILE_BYTES) {
    return NextResponse.json({ error: "invalid file offer" }, { status: 400 });
  }
  const target = await resolveShareTarget(auth.device, targetDeviceId, "file");
  if (!target) return NextResponse.json({ error: "target device is unavailable" }, { status: 404 });
  if (!request.body) return NextResponse.json({ error: "invalid file offer" }, { status: 400 });
  const mimeType = (request.headers.get("content-type") || "application/octet-stream").slice(0, 120);
  const transfer = await createFileTransfer({
    sourceDeviceId: auth.device.id,
    targetDeviceId,
    filename,
    mimeType,
    size: announced,
    stream: request.body,
  });
  const queued = await queueShareOffer(target.id, {
    type: "file",
    transferId: transfer.id,
    filename: transfer.filename,
    mimeType: transfer.mimeType,
    size: transfer.size,
    sha256: transfer.sha256,
    sourceName: auth.device.name,
  });
  if (!queued) {
    await discardFileTransfer(transfer.id, target.id);
    return NextResponse.json({ error: "target device has too many pending offers" }, { status: 429 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

function decodeHeader(value: string | null) {
  try {
    return decodeURIComponent(value || "shared-file");
  } catch {
    return "shared-file";
  }
}

function decodeFilename(headers: Headers) {
  const encoded = headers.get("x-homeplace-filename-base64");
  if (encoded && /^[A-Za-z0-9+/]{1,512}={0,2}$/.test(encoded)) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      if (decoded && !decoded.includes("\uFFFD")) return decoded;
    } catch {
      // Fall back to the legacy percent-encoded header below.
    }
  }
  return decodeHeader(headers.get("x-homeplace-filename"));
}
