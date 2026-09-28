import { PrismaClient } from "@prisma/client";

// A single client per process. Next.js bundles server routes independently in
// production as well as reloading modules in development. Without the shared
// instance, each bundle opens another SQLite connection and concurrent reads
// and writes can block one another indefinitely under background sync load.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = prisma;

/** Read a JSON setting, falling back when it is missing or unparsable. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    update: { value: serialized },
    create: { key, value: serialized },
  });
}
