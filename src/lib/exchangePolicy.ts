import { createHash, randomBytes, randomInt } from "node:crypto";

export const EXCHANGE_FILE_LIMIT = 10 * 1024 ** 3;
export const EXCHANGE_TEXT_LIMIT = 16 * 1024;
export const EXCHANGE_LIFETIMES = [600, 3600, 86400] as const;
export type ExchangeAccess = "account" | "link";
export type ExchangeOptions = {
  expiresInSeconds: (typeof EXCHANGE_LIFETIMES)[number];
  deleteAfterOpen: boolean;
  access: ExchangeAccess;
  quick?: boolean;
};

export function parseExchangeOptions(value: unknown): ExchangeOptions | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const expiresInSeconds = input.expiresInSeconds ?? 3600;
  const access = input.access ?? "link";
  const deleteAfterOpen = input.deleteAfterOpen ?? false;
  if (!EXCHANGE_LIFETIMES.some((seconds) => seconds === expiresInSeconds)) return null;
  if (access !== "account" && access !== "link") return null;
  if (typeof deleteAfterOpen !== "boolean") return null;
  if (input.quick !== undefined && typeof input.quick !== "boolean") return null;
  // Public one-time sharing is the quick flow, including requests from older clients.
  if (input.quick === true || (access === "link" && deleteAfterOpen)) {
    return { expiresInSeconds: 600, access: "link", deleteAfterOpen: true, quick: true };
  }
  return { expiresInSeconds: expiresInSeconds as ExchangeOptions["expiresInSeconds"], access, deleteAfterOpen };
}

export function validExchangeToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22}$/.test(value);
}

export function newExchangeToken(): string {
  return randomBytes(16).toString("base64url");
}

const SHORT_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function newShortCode(): string {
  return Array.from({ length: 5 }, () => SHORT_ALPHABET[randomInt(SHORT_ALPHABET.length)]).join("");
}
export function validShortCode(value: unknown): value is string {
  return typeof value === "string" && value.length === 5 && [...value].every((character) => SHORT_ALPHABET.includes(character));
}

export function exchangeTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function validExchangeText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= EXCHANGE_TEXT_LIMIT;
}
