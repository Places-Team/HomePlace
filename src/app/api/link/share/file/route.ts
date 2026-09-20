import { NextResponse, type NextRequest } from "next/server";
import { canEdit } from "@/lib/auth";
import { appUrl, settings } from "@/lib/config";
import { createFileTransfer, discardFileTransfer } from "@/lib/linkFiles";
import { queueShareOffer, resolveShareTarget } from "@/lib/linkDevices";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { MAX_SHARE_FILE_BYTES, safeFilename, validDeviceId } from "@/lib/linkShare";
import { isSameOriginRequest } from "@/lib/security";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_MULTIPART_OVERHEAD = 1024 * 1024;

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!canEdit(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isSameOriginRequest(request.headers, appUrl(), settings.trustProxyHeaders())) {
    return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
  }
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(announced) && announced > MAX_SHARE_FILE_BYTES + MAX_MULTIPART_OVERHEAD) {
    return NextResponse.json({ error: "file is too large" }, { status: 413 });
  }
  const rate = checkDeviceActionRateLimit(user!.id, "dashboard-share-file", 10);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "too many file requests" },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form" }, { status: 400 });
  }
  const targetDeviceId = validDeviceId(form.get("targetDeviceId"));
  const file = form.get("file");
  if (!targetDeviceId || !(file instanceof File) || file.size < 1) {
    return NextResponse.json({ error: "invalid file offer" }, { status: 400 });
  }
  if (file.size > MAX_SHARE_FILE_BYTES) {
    return NextResponse.json({ error: "file is too large" }, { status: 413 });
  }
  const target = await resolveShareTarget(
    {
      id: `dashboard:${user!.id}`,
      userId: user!.id,
      capabilities: JSON.stringify([{ name: "share.send", version: 1, constraints: {} }]),
    },
    targetDeviceId,
    "file",
  );
  if (!target) return NextResponse.json({ error: "target device unavailable" }, { status: 404 });

  const transfer = await createFileTransfer({
    sourceDeviceId: `dashboard:${user!.id}`,
    targetDeviceId,
    filename: safeFilename(file.name),
    mimeType: (file.type || "application/octet-stream").slice(0, 120),
    bytes: Buffer.from(await file.arrayBuffer()),
  });
  const queued = await queueShareOffer(target.id, {
    type: "file",
    transferId: transfer.id,
    filename: transfer.filename,
    mimeType: transfer.mimeType,
    size: transfer.size,
    sha256: transfer.sha256,
    sourceName: "HomePlace",
  });
  if (!queued) {
    await discardFileTransfer(transfer.id, target.id);
    return NextResponse.json({ error: "target device has too many pending offers" }, { status: 429 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
