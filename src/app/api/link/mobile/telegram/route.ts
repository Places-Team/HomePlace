import { NextResponse } from "next/server";
import { telegramConfig } from "@/lib/integrations";
import { authorizeMobile } from "@/lib/linkMobile";
import { sendWith } from "@/lib/telegram";

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "telegram.send");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const config = await telegramConfig();
  if (!config?.enabled) return NextResponse.json({ error: "telegram is not enabled" }, { status: 409 });
  const result = await sendWith(config, `✅ HomePlace mobile is connected: <b>${escapeHtml(auth.device.name)}</b>`);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
