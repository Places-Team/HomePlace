import { NextResponse } from "next/server";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { createBatch, getBatch } from "@/lib/linkBatches";
import { validDeviceId } from "@/lib/linkShare";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!checkDeviceActionRateLimit(auth.device.id, "share-batch", 10).allowed) return NextResponse.json({ error: "too many batches" }, { status: 429 });
  const body = await boundedJson(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid batch" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const target = validDeviceId(input.targetDeviceId);
  const key = input.requestKey === undefined ? undefined : validDeviceId(input.requestKey);
  if (key === null) return NextResponse.json({ error: "invalid request key" }, { status: 400 });
  const batch = target ? await createBatch(auth.device, target, input.files, key) : null;
  return NextResponse.json(batch ? { batch } : { error: "invalid manifest, unsupported recipient or batch limit reached" }, { status: batch ? 201 : 400 });
}

export async function GET(request: Request) {
  const auth = await authorizeMobile(request, "share.relay");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rows = await prisma.linkShareBatch.findMany({ where: { expiresAt: { gt: new Date() }, OR: [{ sourceDeviceId: auth.device.id }, { targetDeviceId: auth.device.id, status: { not: "assembling" } }] }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true } });
  const batches = [];
  for (const row of rows) {
    const batch = await getBatch(row.id, auth.device);
    if (batch) batches.push(batch);
  }
  return NextResponse.json({ batches }, { headers: { "Cache-Control": "private, no-store" } });
}
