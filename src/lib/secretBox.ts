import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac } from "node:crypto";
import { getSetting, setSetting } from "./db";

/**
 * Encryption for the credentials entered through the interface.
 *
 * Configuring Prometheus, Proxmox and Telegram from a settings page means their
 * tokens end up in the database, and a database gets copied to backups, to a
 * laptop, into a bug report. So they are stored encrypted with a key derived
 * from AUTH_SECRET, which lives only in .env.
 *
 * What this does and does not buy: someone who steals the database file alone
 * cannot read the tokens; someone who also has .env, or who is root on the
 * server, can. That is the honest limit of encrypting data with a key the same
 * application must be able to read — and it is still worth doing, because the
 * database is the part that travels.
 */

const MARK = "hpe1."; // marks a value as encrypted by this scheme
const ALGO = "aes-256-gcm";

let cachedKey: Buffer | null = null;

async function key(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.AUTH_SECRET?.trim();
  // Falls back to the generated session key when AUTH_SECRET is unset — the
  // same one session.ts uses, so an installation without .env still works.
  const material = fromEnv || (await getSetting<string | null>("auth.secret", null)) || (await generateFallback());
  cachedKey = createHash("sha256").update(`homeplace:secretbox:${material}`).digest();
  return cachedKey;
}

async function generateFallback(): Promise<string> {
  const generated = randomBytes(32).toString("hex");
  await setSetting("auth.secret", generated);
  return generated;
}

export async function secretIndex(value: string): Promise<string> {
  return createHmac("sha256", await key()).update("exchange-short:").update(value).digest("hex");
}

export async function encrypt(plain: string): Promise<string> {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, await key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MARK + Buffer.concat([iv, tag, body]).toString("base64");
}

/**
 * Decrypt a stored value. A string without the marker is returned unchanged:
 * that is what a value written before encryption existed looks like, and
 * refusing to read it would lock the user out of their own settings.
 */
export async function decrypt(stored: string): Promise<string> {
  if (!stored) return "";
  if (!stored.startsWith(MARK)) return stored;
  try {
    const raw = Buffer.from(stored.slice(MARK.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv(ALGO, await key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key — almost always AUTH_SECRET was changed. Report it as "no
    // value" so the settings page shows an empty field to fill in again,
    // rather than a stack trace.
    console.error("could not decrypt a stored secret — has AUTH_SECRET changed?");
    return "";
  }
}

/** What the interface shows instead of a stored secret. */
export function mask(value: string | undefined | null): string {
  if (!value) return "";
  return value.length <= 4 ? "••••" : `${"•".repeat(8)}${value.slice(-4)}`;
}
