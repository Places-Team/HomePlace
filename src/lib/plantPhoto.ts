export const MAX_PLANT_PHOTO_BYTES = 12 * 1024 * 1024;
export function plantPhotoType(
  bytes: Buffer,
): { type: string; extension: string } | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { type: "image/jpeg", extension: "jpg" };
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { type: "image/png", extension: "png" };
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return { type: "image/webp", extension: "webp" };
  return null;
}
export async function readPlantPhotoBody(request: Request): Promise<Buffer> {
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (announced > MAX_PLANT_PHOTO_BYTES) throw new Error("photo too large");
  if (!request.body) throw new Error("empty photo");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PLANT_PHOTO_BYTES) {
        await reader.cancel();
        throw new Error("photo too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new Error("empty photo");
  return Buffer.concat(chunks, length);
}
