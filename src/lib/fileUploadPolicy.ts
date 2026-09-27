import { mkdir, statfs } from "node:fs/promises";

export const TEN_GIB = 10 * 1024 ** 3;
const GIB = 1024 ** 3;
const FREE_SPACE_RESERVE = 2 * GIB;
let reservedBytes = 0;

export function configuredFileLimit(): number {
  const value = Number(process.env.MAX_FILE_UPLOAD_GIB ?? 10);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("MAX_FILE_UPLOAD_GIB must be an integer from 1 to 10");
  }
  return value * GIB;
}

function dataDirectory(): string {
  return process.env.DATA_DIR?.trim() || "/data";
}

export async function availableFileLimit(): Promise<number> {
  const directory = dataDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const disk = await statfs(directory);
  const free = Number(BigInt(disk.bavail) * BigInt(disk.bsize));
  return Math.max(0, Math.min(configuredFileLimit(), free - FREE_SPACE_RESERVE - reservedBytes));
}

/** Reserve the announced size before streaming; always release in finally. */
export async function reserveFileUpload(size: number): Promise<() => void> {
  if (!Number.isSafeInteger(size) || size < 1 || size > await availableFileLimit()) {
    throw new Error("file exceeds server upload limit or available storage");
  }
  reservedBytes += size;
  let released = false;
  return () => {
    if (!released) {
      reservedBytes -= size;
      released = true;
    }
  };
}
