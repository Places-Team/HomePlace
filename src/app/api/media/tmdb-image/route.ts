import { requireUser } from "@/lib/auth";
import { readCachedImage, writeCachedImage } from "@/lib/mediaCache";
import { jellyfinConfig } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const imagePath = url.searchParams.get("path") ?? "";
  const size = url.searchParams.get("size") === "original" ? "original" : "w500";
  if (!/^\/[a-zA-Z0-9._/-]{1,300}$/.test(imagePath) || imagePath.includes("..")) return new Response("Invalid image", { status: 400 });
  const key = `tmdb-${size}-${imagePath}`;
  const config = await jellyfinConfig();
  if (config?.cacheLocally) {
    const cached = await readCachedImage(key);
    if (cached) return new Response(cached.body.buffer.slice(cached.body.byteOffset, cached.body.byteOffset + cached.body.byteLength) as ArrayBuffer, { headers: { "content-type": cached.contentType, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
  }
  try {
    const upstream = await fetch(`https://image.tmdb.org/t/p/${size}${imagePath}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return new Response("Image unavailable", { status: 404 });
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > 12 * 1024 * 1024) return new Response("Image too large", { status: 413 });
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    if (config?.cacheLocally) await writeCachedImage(key, body, contentType).catch(() => undefined);
    return new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { headers: { "content-type": contentType, "cache-control": `private, max-age=${config?.cacheLocally ? 86400 : 3600}`, "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("Image unavailable", { status: 504 });
  }
}
