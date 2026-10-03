import type { PrismaClient } from "@prisma/client";

type InitialOwner = { name: string; login: string; passwordHash: string; locale: string };

class SetupClosed extends Error {}

export async function createInitialOwner(db: PrismaClient, input: InitialOwner) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.setting.create({ data: { key: "setup.initialOwner", value: input.login } });
      if (await tx.user.count() !== 0) throw new SetupClosed();
      const user = await tx.user.create({ data: {
        name: input.name, login: input.login, passwordHash: input.passwordHash,
        role: "owner", locale: input.locale, lastLoginAt: new Date(),
      } });
      await tx.dashboard.create({ data: { name: "Home", order: 0, shared: true, ownerId: user.id } });
      return user;
    });
  } catch (error) {
    if (error instanceof SetupClosed) return null;
    // A concurrent setup may lose either the unique marker or SQLite's write lock.
    // Only classify it as closed after checking persisted state.
    const closed = await db.setting.findUnique({ where: { key: "setup.initialOwner" } });
    if (closed || await db.user.count() > 0) return null;
    throw error;
  }
}
