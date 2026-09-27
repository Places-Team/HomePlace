import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizeMobile } from "@/lib/linkMobile";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";

export const dynamic = "force-dynamic";

const clientId = z.string().uuid();
const text = (limit: number) => z.string().trim().max(limit).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n|\t/g, "")));
const fields = {
  name: text(80).pipe(z.string().min(1)),
  species: text(120),
  location: text(120),
  notes: text(2000),
  intervalDays: z.number().int().min(1).max(365),
  lastWateredAt: z.string().datetime({ offset: true }),
};
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), clientId, ...fields }),
  z.object({ action: z.literal("update"), clientId, revision: z.number().int().positive(), ...fields }),
  z.object({ action: z.literal("delete"), clientId, revision: z.number().int().positive() }),
]);

const select = {
  clientId: true, name: true, species: true, location: true, notes: true,
  intervalDays: true, lastWateredAt: true, revision: true, deletedAt: true,
  createdAt: true, updatedAt: true,
} as const;

export async function GET(request: Request) {
  const auth = await authorizeMobile(request, "plants.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const plants = await prisma.plant.findMany({
    where: { userId: auth.device.userId }, orderBy: { createdAt: "asc" },
    take: 501, select,
  });
  if (plants.length > 500) return NextResponse.json({ error: "plant limit exceeded" }, { status: 409 });
  // Tombstones stay in this snapshot so an offline client cannot resurrect a deletion.
  return NextResponse.json({ plants }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizeMobile(request, "plants.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rate = checkDeviceActionRateLimit(auth.device.id, "plants-manage", 60);
  if (!rate.allowed) return NextResponse.json({ error: "too many plant changes" }, { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } });
  const parsed = command.safeParse(await boundedJson(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid plant request" }, { status: 400 });
  const input = parsed.data;
  const userId = auth.device.userId;
  const key = { userId_clientId: { userId, clientId: input.clientId } };
  if (input.action === "create") {
    const existing = await prisma.plant.findUnique({ where: key, select });
    if (existing) return NextResponse.json({ plant: existing, existing: true });
    if (await prisma.plant.count({ where: { userId } }) >= 500) return NextResponse.json({ error: "plant limit reached" }, { status: 409 });
    try {
      const plant = await prisma.plant.create({ data: {
        userId, clientId: input.clientId, name: input.name, species: input.species,
        location: input.location, notes: input.notes, intervalDays: input.intervalDays,
        lastWateredAt: new Date(input.lastWateredAt),
      }, select });
      return NextResponse.json({ plant }, { status: 201 });
    } catch (error) {
      // Concurrent retries with the same stable client ID are idempotent.
      const raced = await prisma.plant.findUnique({ where: key, select });
      if (raced) return NextResponse.json({ plant: raced, existing: true });
      throw error;
    }
  }
  const current = await prisma.plant.findUnique({ where: key, select });
  if (!current) return NextResponse.json({ error: "plant not found" }, { status: 404 });
  if (current.revision !== input.revision || current.deletedAt) return NextResponse.json({ error: "plant conflict", plant: current }, { status: 409 });
  const changed = await prisma.plant.updateMany({
    where: { userId, clientId: input.clientId, revision: input.revision, deletedAt: null },
    data: input.action === "delete"
      ? { deletedAt: new Date(), revision: { increment: 1 } }
      : { name: input.name, species: input.species, location: input.location, notes: input.notes,
          intervalDays: input.intervalDays, lastWateredAt: new Date(input.lastWateredAt), revision: { increment: 1 } },
  });
  const plant = await prisma.plant.findUnique({ where: key, select });
  if (!changed.count) return NextResponse.json({ error: "plant conflict", plant }, { status: 409 });
  return NextResponse.json({ plant });
}
