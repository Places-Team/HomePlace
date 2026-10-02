import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorizePlantRequest } from "@/lib/plantAccess";
import { plantDto, plantSelect } from "@/lib/plants";
import { readPlantPhotoBody, plantPhotoType } from "@/lib/plantPhoto";
import {
  readPlantPhoto,
  savePlantPhoto,
  removePlantPhoto,
} from "@/lib/plantPhotoStorage";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ clientId: string }> };
async function access(request: Request, context: Context) {
  const auth = await authorizePlantRequest(request);
  if (!auth.ok)
    return {
      response: NextResponse.json(
        { error: auth.error },
        { status: auth.status },
      ),
    };
  const { clientId } = await context.params;
  if (!z.string().uuid().safeParse(clientId).success)
    return {
      response: NextResponse.json(
        { error: "invalid plant ID" },
        { status: 400 },
      ),
    };
  const plant = await prisma.plant.findUnique({
    where: { userId_clientId: { userId: auth.userId, clientId } },
    select: plantSelect,
  });
  if (!plant || plant.deletedAt)
    return {
      response: NextResponse.json(
        { error: "plant not found" },
        { status: 404 },
      ),
    };
  return { auth, plant, clientId };
}
export async function GET(request: Request, context: Context) {
  const found = await access(request, context);
  if (found.response) return found.response;
  const { auth, plant, clientId } = found;
  if (!plant.photoName) return new NextResponse(null, { status: 404 });
  const photo = await readPlantPhoto(auth.userId, clientId, plant.photoName);
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      "content-type": photo.type,
      "content-length": String(photo.bytes.length),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      etag: `"${plant.photoName}"`,
    },
  });
}
async function change(request: Request, context: Context, deleting: boolean) {
  const found = await access(request, context);
  if (found.response) return found.response;
  const { auth, plant, clientId } = found;
  const rate = checkDeviceActionRateLimit(auth.rateKey, "plant-photo", 20);
  if (!rate.allowed)
    return NextResponse.json(
      { error: "too many photo changes" },
      { status: 429 },
    );
  const rawRevision = request.headers.get("if-match")?.replace(/^"|"$/g, "");
  if (!rawRevision || !/^[1-9]\d*$/.test(rawRevision))
    return NextResponse.json(
      { error: "If-Match must contain the plant revision" },
      { status: 428 },
    );
  const revision = Number(rawRevision);
  if (revision !== plant.revision)
    return NextResponse.json(
      { error: "plant conflict", plant: plantDto(plant) },
      { status: 409 },
    );
  let name: string | null = null;
  if (!deleting) {
    let bytes: Buffer;
    try {
      bytes = await readPlantPhotoBody(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid photo";
      return NextResponse.json(
        { error: message },
        { status: message.includes("too large") ? 413 : 400 },
      );
    }
    const format = plantPhotoType(bytes);
    if (
      !format ||
      request.headers.get("content-type")?.split(";")[0].trim() !== format.type
    )
      return NextResponse.json(
        {
          error:
            "upload a JPEG, PNG or WebP image with its correct Content-Type",
        },
        { status: 415 },
      );
    name = await savePlantPhoto(auth.userId, clientId, bytes);
  }
  let changed;
  try {
    changed = await prisma.plant.updateMany({
      where: { userId: auth.userId, clientId, revision, deletedAt: null },
      data: { photoName: name, revision: { increment: 1 } },
    });
  } catch (error) {
    await removePlantPhoto(auth.userId, clientId, name);
    throw error;
  }
  if (!changed.count) await removePlantPhoto(auth.userId, clientId, name);
  else await removePlantPhoto(auth.userId, clientId, plant.photoName);
  const current = await prisma.plant.findUnique({
    where: { userId_clientId: { userId: auth.userId, clientId } },
    select: plantSelect,
  });
  return NextResponse.json(
    {
      ...(changed.count ? {} : { error: "plant conflict" }),
      plant: current ? plantDto(current) : null,
    },
    { status: changed.count ? 200 : 409 },
  );
}
export async function POST(request: Request, context: Context) {
  return change(request, context, false);
}
export async function DELETE(request: Request, context: Context) {
  return change(request, context, true);
}
