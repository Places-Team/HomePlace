import { NextResponse } from "next/server";
import { authenticateLinkDevice } from "@/lib/linkDevices";
import { consumeFileTransfer } from "@/lib/linkFiles";
import { validDeviceId } from "@/lib/linkShare";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const device = await authenticateLinkDevice(request);
  if (!device) return NextResponse.json({ error: "invalid device credential" }, { status: 401 });
  const id = validDeviceId((await context.params).id);
  if (!id) return NextResponse.json({ error: "file is unavailable" }, { status: 404 });
  const transfer = await consumeFileTransfer(id, device.id);
  if (!transfer) return NextResponse.json({ error: "file is unavailable" }, { status: 404 });
  return new Response(transfer.bytes, {
    headers: {
      "content-type": transfer.mimeType,
      "content-length": String(transfer.bytes.length),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(transfer.filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "x-homeplace-sha256": transfer.sha256,
    },
  });
}
