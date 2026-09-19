import { createPublicKey } from "node:crypto";

export const LINK_PROTOCOL_MIN = 1;
export const LINK_PROTOCOL_MAX = 1;

export type LinkInfo = {
  product: "HomePlace";
  server: {
    id: string;
    name: string;
  };
  protocol: {
    min: number;
    max: number;
  };
  serverTime: string;
  features: {
    pairing: boolean;
    realtime: boolean;
  };
};

export const LINK_CAPABILITIES = new Set([
  "notification.receive",
  "url.open",
  "text.receive",
  "file.receive",
  "share.send",
  "device.battery",
  "device.network",
  "device.presence",
]);

export type LinkCapability = {
  name: string;
  version: number;
  constraints: Record<string, string>;
};

export type LinkPairRequest = {
  protocol: number;
  device: {
    name: string;
    platform: "android" | "ios";
    platformVersion: string;
    appVersion: string;
  };
  publicKey: string;
  capabilities: LinkCapability[];
};

type LinkInfoInput = {
  serverId: string;
  serverName: string;
  now?: Date;
};

/** Builds the public installation description used before a device is paired. */
export function createLinkInfo(input: LinkInfoInput): LinkInfo {
  return {
    product: "HomePlace",
    server: {
      id: input.serverId,
      name: input.serverName,
    },
    protocol: {
      min: LINK_PROTOCOL_MIN,
      max: LINK_PROTOCOL_MAX,
    },
    serverTime: (input.now ?? new Date()).toISOString(),
    // These switches describe usable server features, not roadmap intent.
    features: {
      pairing: true,
      realtime: false,
    },
  };
}

/** Parse the deliberately small public pairing document before database work. */
export function parseLinkPairRequest(value: unknown): LinkPairRequest | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.protocol !== LINK_PROTOCOL_MAX || !input.device || typeof input.device !== "object") return null;
  const device = input.device as Record<string, unknown>;
  const name = shortText(device.name, 80);
  const platform = device.platform === "android" || device.platform === "ios" ? device.platform : null;
  const platformVersion = shortText(device.platformVersion, 40);
  const appVersion = shortText(device.appVersion, 40);
  const publicKey = typeof input.publicKey === "string" && isP256PublicKey(input.publicKey)
    ? input.publicKey
    : null;
  if (!name || !platform || !platformVersion || !appVersion || !publicKey || !Array.isArray(input.capabilities)) return null;

  const capabilities: LinkCapability[] = [];
  const seen = new Set<string>();
  for (const raw of input.capabilities) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== "string" || !LINK_CAPABILITIES.has(item.name) || seen.has(item.name)) return null;
    if (!Number.isInteger(item.version) || Number(item.version) < 1 || Number(item.version) > 10) return null;
    if (!plainStringMap(item.constraints)) return null;
    seen.add(item.name);
    capabilities.push({ name: item.name, version: Number(item.version), constraints: item.constraints });
  }
  if (capabilities.length > 16) return null;
  return {
    protocol: LINK_PROTOCOL_MAX,
    device: { name, platform, platformVersion, appVersion },
    publicKey,
    capabilities,
  };
}

function isP256PublicKey(value: string): boolean {
  try {
    const der = Buffer.from(value, "base64");
    if (der.length !== 91 || der.toString("base64") !== value) return false;
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

function plainStringMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 16 && entries.every(([key, item]) => key.length <= 60 && typeof item === "string" && item.length <= 160);
}

/** Server IDs are UUIDs so clients can validate them without knowing the database. */
export function isLinkServerId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
