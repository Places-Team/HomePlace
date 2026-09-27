import { NextResponse } from "next/server";
import { exchangeActor } from "@/lib/exchangeAuth";
import { createTextExchange, listExchanges } from "@/lib/exchange";
import { parseExchangeOptions, validExchangeText } from "@/lib/exchangePolicy";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const actor = await exchangeActor(request, false);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  return NextResponse.json({ exchanges: await listExchanges(actor.userId) }, { headers });
}

export async function POST(request: Request) {
  const actor = await exchangeActor(request, true);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const rate = checkDeviceActionRateLimit(actor.userId, "exchange-create", 20);
  if (!rate.allowed) return NextResponse.json({ error: "too many exchanges" }, { status: 429, headers });
  const input = await boundedJson(request);
  if (!input || typeof input !== "object") return NextResponse.json({ error: "invalid exchange" }, { status: 400, headers });
  const data = input as Record<string, unknown>;
  const options = parseExchangeOptions(data);
  if (!options || !validExchangeText(data.text)) return NextResponse.json({ error: "invalid text or options" }, { status: 400, headers });
  try {
    const exchange = await createTextExchange(actor.userId, data.text, options);
    return NextResponse.json({ exchange }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Error && error.message === "too many active exchanges") {
      return NextResponse.json({ error: error.message }, { status: 429, headers });
    }
    throw error;
  }
}
