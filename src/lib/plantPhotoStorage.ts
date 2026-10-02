import "server-only";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { plantPhotoType } from "./plantPhoto";

function directory(userId: string, clientId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error("invalid plant ID");
  const owner = createHash("sha256").update(userId).digest("hex");
  const root = process.env.DATA_DIR?.trim() || "/data";
  return path.join(/* turbopackIgnore: true */ root, "plants", owner, clientId);
}
function photoPath(userId: string, clientId: string, name: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name))
    throw new Error("invalid photo name");
  return path.join(
    /* turbopackIgnore: true */ directory(userId, clientId),
    name,
  );
}
export async function savePlantPhoto(
  userId: string,
  clientId: string,
  bytes: Buffer,
): Promise<string> {
  const format = plantPhotoType(bytes);
  if (!format) throw new Error("unsupported photo format");
  const name = `${randomUUID()}.${format.extension}`;
  await mkdir(directory(userId, clientId), { recursive: true });
  await writeFile(photoPath(userId, clientId, name), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  return name;
}
export async function readPlantPhoto(
  userId: string,
  clientId: string,
  name: string,
) {
  try {
    const bytes = await readFile(photoPath(userId, clientId, name));
    const format = plantPhotoType(bytes);
    return format ? { bytes, type: format.type } : null;
  } catch {
    return null;
  }
}
export async function removePlantPhoto(
  userId: string,
  clientId: string,
  name: string | null,
) {
  if (name) await unlink(photoPath(userId, clientId, name)).catch(() => {});
}
