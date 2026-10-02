import "server-only";
import { z } from "zod";
import { prisma, getSetting, setSetting } from "./db";
import { normalizePlantSettings, validPlantTimeZone } from "./plantCare";
import { removePlantPhoto } from "./plantPhotoStorage";

const clientId = z.string().uuid();
const text = (limit: number) =>
  z
    .string()
    .trim()
    .max(limit)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n|\t/g, "")));
const fields = {
  name: text(80).pipe(z.string().min(1)),
  species: text(120),
  location: text(120),
  notes: text(2000),
  intervalDays: z.number().int().min(1).max(365),
  lastWateredAt: z.string().datetime({ offset: true }),
  remindersEnabled: z.boolean().optional(),
};
export const plantCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), clientId, ...fields }),
  z.object({
    action: z.literal("update"),
    clientId,
    revision: z.number().int().positive(),
    ...fields,
  }),
  z.object({
    action: z.literal("delete"),
    clientId,
    revision: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("water"),
    clientId,
    revision: z.number().int().positive(),
    lastWateredAt: z.string().datetime({ offset: true }),
  }),
]);

export const plantSettingsInput = z
  .object({
    enabled: z.boolean().optional(),
    app: z.boolean().optional(),
    telegram: z.boolean().optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    timeZone: z.string().max(80).refine(validPlantTimeZone).optional(),
    repeatDays: z.number().int().min(0).max(30).optional(),
  })
  .strict();

export async function plantSettings(userId: string) {
  return normalizePlantSettings(
    await getSetting(`plants.notifications:${userId}`, null),
  );
}
export async function savePlantSettings(userId: string, input: unknown) {
  const parsed = plantSettingsInput.safeParse(input);
  if (!parsed.success) throw new Error("invalid plant notification settings");
  const previous = await plantSettings(userId);
  const settings = normalizePlantSettings({ ...previous, ...parsed.data });
  await setSetting(`plants.notifications:${userId}`, settings);
  if (!settings.enabled || !settings.app) {
    await prisma.linkDeviceEvent.deleteMany({
      where: {
        device: { userId },
        kind: "notification.deliver",
        deliveredAt: null,
        payload: { contains: '"tag":"plant-' },
      },
    });
  }
  if (!settings.enabled || (!settings.app && !settings.telegram)) {
    await prisma.plantAlert.updateMany({
      where: { plant: { userId }, finishedAt: null },
      data: { finishedAt: new Date() },
    });
  }
  if (
    settings.enabled &&
    (!previous.enabled ||
      (!previous.app && settings.app) ||
      (!previous.telegram && settings.telegram))
  ) {
    const undelivered = [
      ...(settings.app ? [{ appDeliveredAt: null }] : []),
      ...(settings.telegram ? [{ telegramDeliveredAt: null }] : []),
    ];
    if (undelivered.length)
      await prisma.plantAlert.updateMany({
        where: {
          plant: { userId },
          finishedAt: { not: null },
          createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
          OR: undelivered,
        },
        data: { finishedAt: null, nextAttemptAt: new Date(), lastError: null },
      });
  }
  return settings;
}

export const plantSelect = {
  clientId: true,
  name: true,
  species: true,
  location: true,
  notes: true,
  intervalDays: true,
  lastWateredAt: true,
  remindersEnabled: true,
  photoName: true,
  revision: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
type PlantRecord = Awaited<ReturnType<typeof listPlants>>[number];
export function plantDto(plant: PlantRecord) {
  const { photoName, ...fields } = plant;
  return {
    ...fields,
    photo:
      photoName && !plant.deletedAt
        ? {
            url: `/api/link/plants/${plant.clientId}/photo`,
            version: photoName,
            maxBytes: 12 * 1024 * 1024,
          }
        : null,
  };
}
export async function listPlants(userId: string) {
  return prisma.plant.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: plantSelect,
    take: 501,
  });
}

export async function changePlant(
  userId: string,
  input: z.infer<typeof plantCommand>,
) {
  const key = { userId_clientId: { userId, clientId: input.clientId } };
  if (input.action === "create") {
    const existing = await prisma.plant.findUnique({
      where: key,
      select: plantSelect,
    });
    if (existing)
      return {
        status: 200,
        body: { plant: plantDto(existing), existing: true },
      };
    if ((await prisma.plant.count({ where: { userId } })) >= 500)
      return { status: 409, body: { error: "plant limit reached" } };
    try {
      const { action: _action, ...data } = input;
      const plant = await prisma.plant.create({
        data: { ...data, userId, lastWateredAt: new Date(input.lastWateredAt) },
        select: plantSelect,
      });
      return { status: 201, body: { plant: plantDto(plant) } };
    } catch (error) {
      const raced = await prisma.plant.findUnique({
        where: key,
        select: plantSelect,
      });
      if (raced)
        return {
          status: 200,
          body: { plant: plantDto(raced), existing: true },
        };
      throw error;
    }
  }
  const current = await prisma.plant.findUnique({
    where: key,
    select: plantSelect,
  });
  if (!current) return { status: 404, body: { error: "plant not found" } };
  if (current.revision !== input.revision || current.deletedAt)
    return {
      status: 409,
      body: { error: "plant conflict", plant: plantDto(current) },
    };
  const data =
    input.action === "delete"
      ? { deletedAt: new Date(), photoName: null, revision: { increment: 1 } }
      : input.action === "water"
        ? {
            lastWateredAt: new Date(input.lastWateredAt),
            revision: { increment: 1 },
          }
        : {
            name: input.name,
            species: input.species,
            location: input.location,
            notes: input.notes,
            intervalDays: input.intervalDays,
            remindersEnabled: input.remindersEnabled,
            lastWateredAt: new Date(input.lastWateredAt),
            revision: { increment: 1 },
          };
  const changed = await prisma.plant.updateMany({
    where: {
      userId,
      clientId: input.clientId,
      revision: input.revision,
      deletedAt: null,
    },
    data,
  });
  const plant = await prisma.plant.findUnique({
    where: key,
    select: plantSelect,
  });
  if (!changed.count)
    return {
      status: 409,
      body: { error: "plant conflict", plant: plant ? plantDto(plant) : null },
    };
  if (input.action === "delete")
    await removePlantPhoto(userId, input.clientId, current.photoName);
  if (
    plant &&
    (plant.deletedAt ||
      !plant.remindersEnabled ||
      plant.intervalDays !== current.intervalDays ||
      plant.lastWateredAt.getTime() !== current.lastWateredAt.getTime())
  ) {
    await prisma.plantAlert.updateMany({
      where: { plant: { userId, clientId: input.clientId }, finishedAt: null },
      data: { finishedAt: new Date() },
    });
    await prisma.linkDeviceEvent.deleteMany({
      where: {
        device: { userId },
        kind: "notification.deliver",
        deliveredAt: null,
        payload: { contains: `"tag":"plant-${input.clientId}"` },
      },
    });
  }
  return { status: 200, body: { plant: plant ? plantDto(plant) : null } };
}
