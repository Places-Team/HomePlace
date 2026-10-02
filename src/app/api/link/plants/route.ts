import { NextResponse } from "next/server";
import { authorizePlantRequest } from "@/lib/plantAccess";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
import {
  changePlant,
  listPlants,
  plantCommand,
  plantDto,
  plantSettings,
} from "@/lib/plants";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizePlantRequest(request);
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  const plants = await listPlants(auth.userId);
  if (plants.length > 500)
    return NextResponse.json(
      { error: "plant sync limit exceeded" },
      { status: 409 },
    );
  return NextResponse.json(
    {
      plants: plants.map(plantDto),
      serverTime: new Date().toISOString(),
      settings: await plantSettings(auth.userId),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const auth = await authorizePlantRequest(request);
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.rateKey, "plants-manage", 60);
  if (!rate.allowed)
    return NextResponse.json(
      { error: "too many plant changes" },
      {
        status: 429,
        headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) },
      },
    );
  const parsed = plantCommand.safeParse(await boundedJson(request));
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid plant request" },
      { status: 400 },
    );
  const result = await changePlant(auth.userId, parsed.data);
  return NextResponse.json(result.body, { status: result.status });
}
