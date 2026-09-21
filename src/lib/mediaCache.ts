import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.env.MEDIA_CACHE_DIR?.trim() || "/data/media-cache";

const safeKey = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);

export async function readCachedJson<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const payload = JSON.parse(await readFile(path.join(ROOT, "metadata", `${safeKey(key)}.json`), "utf8")) as { savedAt: number; value: T };
    return Date.now() - payload.savedAt <= maxAgeMs ? payload.value : null;
  } catch {
    return null;
  }
}

export async function writeCachedJson(key: string, value: unknown): Promise<void> {
  const directory = path.join(ROOT, "metadata");
  const file = path.join(directory, `${safeKey(key)}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, JSON.stringify({ savedAt: Date.now(), value }), { mode: 0o600 });
  await rename(temporary, file);
}

export async function readCachedImage(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const base = path.join(ROOT, "images", safeKey(key));
    const [body, contentType] = await Promise.all([readFile(`${base}.bin`), readFile(`${base}.type`, "utf8")]);
    return { body, contentType: contentType.trim() || "image/jpeg" };
  } catch {
    return null;
  }
}

export async function writeCachedImage(key: string, body: Buffer, contentType: string): Promise<void> {
  const directory = path.join(ROOT, "images");
  const base = path.join(directory, safeKey(key));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(`${base}.bin`, body, { mode: 0o600 }),
    writeFile(`${base}.type`, contentType.slice(0, 120), { mode: 0o600 }),
  ]);
}
