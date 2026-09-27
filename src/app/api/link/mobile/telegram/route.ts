import { NextResponse } from "next/server";
import { telegramConfig } from "@/lib/integrations";
import { authorizeMobile } from "@/lib/linkMobile";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { sendWith } from "@/lib/telegram";

export async function GET(request: Request) {
  const auth = await authorizeMobile(request, "dashboard.read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const config = await telegramConfig();
  const permissions = JSON.parse(auth.device.permissions) as string[];
  return NextResponse.json({
    connected: config !== null,
    enabled: config?.enabled ?? false,
    source: config?.source ?? "none",
    canTest: permissions.includes("telegram.send"),
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "telegram.send");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.device.id, "telegram-test", 3);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "too many telegram tests" },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } },
    );
  }
  const config = await telegramConfig();
  if (!config?.enabled) return NextResponse.json({ error: "telegram is not enabled" }, { status: 409 });
  const result = await sendWith(config, `✅ HomePlace Link is connected: <b>${escapeHtml(auth.device.name)}</b>`);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
