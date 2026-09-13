import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { createLinkInfo, isLinkServerId } from "./linkProtocol";

const SERVER_ID_SETTING = "link.serverId";

function configuredServerId(): string | null {
  const value = process.env.HOMEPLACE_SERVER_ID?.trim() ?? "";
  if (!value) return null;
  if (!isLinkServerId(value)) throw new Error("HOMEPLACE_SERVER_ID must be a UUID");
  return value.toLowerCase();
}

function serverName(): string {
  const value = process.env.HOMEPLACE_NAME?.trim() ?? "";
  return value ? value.slice(0, 80) : "HomePlace";
}

/**
 * Returns an installation identity that survives process and container restarts.
 * A configured ID is useful when an operator deliberately restores an instance;
 * otherwise the database owns the generated value alongside the rest of the
 * installation state.
 */
export async function linkServerId(): Promise<string> {
  const configured = configuredServerId();
  if (configured) return configured;

  const existing = await prisma.setting.findUnique({ where: { key: SERVER_ID_SETTING } });
  if (existing) {
    const value = parseStoredId(existing.value);
    if (!value) throw new Error("Stored HomePlace Link server ID is invalid");
    return value;
  }

  const generated = randomUUID();
  // Upsert makes concurrent first requests converge on the database winner
  // without logging an expected unique-key error. An empty update preserves the
  // identity that was inserted first.
  const winner = await prisma.setting.upsert({
    where: { key: SERVER_ID_SETTING },
    update: {},
    create: { key: SERVER_ID_SETTING, value: JSON.stringify(generated) },
  });
  const value = parseStoredId(winner.value);
  if (!value) throw new Error("Could not create HomePlace Link server ID");
  return value;
}

function parseStoredId(serialized: string): string | null {
  try {
    const value: unknown = JSON.parse(serialized);
    return typeof value === "string" && isLinkServerId(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function linkInfo() {
  return createLinkInfo({
    serverId: await linkServerId(),
    serverName: serverName(),
  });
}
