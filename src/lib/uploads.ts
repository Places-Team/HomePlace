import "server-only";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

/**
 * Images uploaded through the panel: backgrounds and slideshow pictures.
 *
 * They live next to the database, inside the same volume, so one bind mount
 * still covers everything a HomePlace installation owns. Nothing else is
 * accepted — this is a dashboard, not a file host, and an upload endpoint that
 * takes arbitrary files on a box full of media is a liability.
 */

const MAX_BYTES = 12 * 1024 * 1024;

/** Extension per accepted type. The map is also the allowlist. */
const TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/gif": ".gif",
};

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR?.trim() || path.join(process.env.DATA_DIR?.trim() || "/data", "uploads");
}

export type SaveResult = { ok: true; url: string } | { ok: false; error: string };

export async function saveImage(file: File): Promise<SaveResult> {
  const extension = TYPES[file.type];
  if (!extension) return { ok: false, error: `unsupported file type: ${file.type || "unknown"}` };
  if (file.size > MAX_BYTES) return { ok: false, error: `file is larger than ${MAX_BYTES / 1024 / 1024} MB` };

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikeImage(bytes)) {
    // The declared type is whatever the browser was told; the first bytes are
    // what the file actually is.
    return { ok: false, error: "this file is not an image" };
  }

  // Content-addressed: re-uploading the same picture reuses it instead of
  // filling the volume with copies of the same wallpaper.
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const name = `${digest}${extension}`;

  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  // Runtime data lives on the mounted volume and must not be followed by the
  // standalone build tracer into the project tree.
  const target = path.join(/* turbopackIgnore: true */ dir, name);
  if (!(await exists(target))) await writeFile(target, bytes);

  return { ok: true, url: `/api/files/${name}` };
}

/** Read a stored file. Returns null for anything that is not a plain name. */
export async function readStored(name: string): Promise<{ bytes: Buffer; type: string } | null> {
  // No slashes, no dots-dots, nothing but what saveImage generates. Path
  // traversal here would hand out arbitrary files from the server.
  if (!/^[a-f0-9]{8,64}\.(jpg|png|webp|avif|gif)$/.test(name)) return null;

  try {
    const bytes = await readFile(path.join(/* turbopackIgnore: true */ uploadsDir(), name));
    const extension = path.extname(name);
    const type = Object.entries(TYPES).find(([, ext]) => ext === extension)?.[0] ?? "application/octet-stream";
    return { bytes, type };
  } catch {
    return null;
  }
}

/** Magic numbers for the formats above. */
function looksLikeImage(b: Buffer): boolean {
  if (b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8;
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const gif = b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a";
  const riff = b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
  const avif = b.subarray(4, 8).toString("ascii") === "ftyp";
  return jpeg || png || gif || riff || avif;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Random name, used only where content addressing is not wanted. */
export function randomName(extension: string): string {
  return `${randomBytes(8).toString("hex")}${extension}`;
}
