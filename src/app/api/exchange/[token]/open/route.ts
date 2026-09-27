import { NextResponse } from "next/server";
import { canOpenExchange } from "@/lib/exchangeAuth";
import { getExchange, openExchangeText } from "@/lib/exchange";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { clientAddress } from "@/lib/security";
import { settings } from "@/lib/config";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const source = clientAddress(request.headers, settings.trustProxyHeaders());
  if (!checkDeviceActionRateLimit(source, "exchange-open", 120).allowed) {
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers });
  }
  const record = await getExchange((await context.params).token);
  if (!record || !(await canOpenExchange(request, record.access))) {
    return NextResponse.json({ error: "exchange unavailable" }, { status: 404, headers });
  }
  const text = await openExchangeText(record);
  return text === null
    ? NextResponse.json({ error: "exchange unavailable" }, { status: 404, headers })
    : NextResponse.json({ text }, { headers });
}
