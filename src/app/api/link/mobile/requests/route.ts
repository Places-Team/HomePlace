import { NextResponse } from "next/server";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson } from "@/lib/linkRequest";
import { arrAdd } from "@/lib/services";

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "media.request");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await boundedJson(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid media request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const instanceLabel = typeof input.instanceLabel === "string" ? input.instanceLabel.trim().slice(0, 120) : "";
  const externalId = Number(input.externalId);
  if (!instanceLabel || !Number.isInteger(externalId) || externalId <= 0) {
    return NextResponse.json({ error: "invalid media selection" }, { status: 400 });
  }
  const result = await arrAdd(instanceLabel, externalId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
