import { NextResponse } from "next/server";
import { relayClipboard } from "@/lib/linkDevices";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson } from "@/lib/linkRequest";

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "clipboard.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await boundedJson(request);
  const text = body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
    ? (body as { text: string }).text.trim()
    : "";
  if (!text || text.length > 8000) return NextResponse.json({ error: "clipboard text must contain 1 to 8000 characters" }, { status: 400 });
  const recipients = await relayClipboard(auth.device, text);
  return NextResponse.json({ ok: true, recipients });
}
