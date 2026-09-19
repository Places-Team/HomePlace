import { NextResponse } from "next/server";
import { authenticateLinkDevice, revokeLinkDevice } from "@/lib/linkDevices";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const device = await authenticateLinkDevice(request);
  if (!device) return NextResponse.json({ error: "invalid device credential" }, { status: 401 });
  await revokeLinkDevice(device.id);
  return new NextResponse(null, { status: 204 });
}
