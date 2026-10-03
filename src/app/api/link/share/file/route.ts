import { NextResponse, type NextRequest } from "next/server";
import { canEdit } from "@/lib/auth";
import { appUrl, settings } from "@/lib/config";
import { createFileTransfer, discardFileTransfer } from "@/lib/linkFiles";
import { queueShareOffer, resolveShareTarget } from "@/lib/linkDevices";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { MAX_SHARE_FILE_BYTES, safeFilename, validDeviceId } from "@/lib/linkShare";
import { availableFileLimit } from "@/lib/fileUploadPolicy";
import { isSameOriginRequest } from "@/lib/security";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!canEdit(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isSameOriginRequest(request.headers, appUrl(), settings.trustProxyHeaders())) {
    return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
  }
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isSafeInteger(announced) || announced < 1 || announced > MAX_SHARE_FILE_BYTES || announced > await availableFileLimit()) {
    return NextResponse.json({ error: "file is too large" }, { status: 413 });
  }
  const rate = checkDeviceActionRateLimit(user!.id, "dashboard-share-file", 10);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "too many file requests" },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } },
    );
  }

  const targetDeviceId = validDeviceId(request.headers.get("x-homeplace-target"));
  const filename = safeFilename(decodeFilename(request.headers));
  if (!targetDeviceId || !request.body) {
    return NextResponse.json({ error: "invalid file offer" }, { status: 400 });
  }
  const dashboardShareCapability = JSON.stringify([{ name: "share.send", version: 1, constraints: {} }]);
  const target = await resolveShareTarget(
    {
      id: `dashboard:${user!.id}`,
      userId: user!.id,
      capabilities: dashboardShareCapability,
      approvedCapabilities: dashboardShareCapability,
    },
    targetDeviceId,
    "file",
  );
  if (!target) return NextResponse.json({ error: "target device unavailable" }, { status: 404 });

  let transfer: Awaited<ReturnType<typeof createFileTransfer>>;
  try {
    transfer = await createFileTransfer({
      sourceDeviceId: `dashboard:${user!.id}`,
      targetDeviceId,
      filename,
      mimeType: (request.headers.get("content-type") || "application/octet-stream").slice(0, 120),
      size: announced,
      stream: request.body,
    });
  } catch (error) {
    if (error instanceof Error && /file size|file is too large|upload limit|storage/.test(error.message)) {
      return NextResponse.json({ error: "file exceeds server upload limit or available storage" }, { status: 413 });
    }
    throw error;
  }
  const queued = await queueShareOffer(target.id, {
    type: "file",
    transferId: transfer.id,
    filename: transfer.filename,
    mimeType: transfer.mimeType,
    size: Number(transfer.size),
    sha256: transfer.sha256,
    sourceName: "HomePlace",
    sameAccount: target.userId === user!.id,
  });
  if (!queued) {
    await discardFileTransfer(transfer.id, target.id);
    return NextResponse.json({ error: "target device has too many pending offers" }, { status: 429 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

function decodeFilename(headers: Headers) {
  const encoded = headers.get("x-homeplace-filename-base64");
  if (encoded && /^[A-Za-z0-9+/]{1,512}={0,2}$/.test(encoded)) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      if (decoded && !decoded.includes("\uFFFD")) return decoded;
    } catch {
      // Fall back to a safe default below.
    }
  }
  return "shared-file";
}
