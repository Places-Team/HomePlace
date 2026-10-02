import { NextResponse } from "next/server";
import { authorizePlantRequest } from "@/lib/plantAccess";
import { plantSettings, savePlantSettings } from "@/lib/plants";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizePlantRequest(request);
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(
    { settings: await plantSettings(auth.userId) },
    { headers: { "cache-control": "no-store" } },
  );
}
export async function PATCH(request: Request) {
  const auth = await authorizePlantRequest(request);
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.rateKey, "plant-settings", 20);
  if (!rate.allowed)
    return NextResponse.json(
      { error: "too many settings changes" },
      { status: 429 },
    );
  try {
    return NextResponse.json({
      settings: await savePlantSettings(
        auth.userId,
        await boundedJson(request),
      ),
    });
  } catch {
    return NextResponse.json(
      { error: "invalid plant notification settings" },
      { status: 400 },
    );
  }
}
