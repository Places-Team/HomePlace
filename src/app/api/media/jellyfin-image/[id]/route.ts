import { requireUser } from "@/lib/auth";
import { jellyfinAuthHeaders, jellyfinConfig, jellyfinServerUrl } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const cfg = await jellyfinConfig();
  if (!cfg) return new Response("Jellyfin is not configured", { status: 404 });
  const serverUrl = await jellyfinServerUrl(cfg);

  const { id } = await params;
  if (!/^[a-z0-9-]{1,80}$/i.test(id)) return new Response("Invalid item", { status: 400 });

  try {
    const upstream = await fetch(`${serverUrl}/Items/${encodeURIComponent(id)}/Images/Primary?maxHeight=600&quality=85`, {
      headers: jellyfinAuthHeaders(cfg.apiKey),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok || !upstream.body) return new Response("Image unavailable", { status: 404 });
    const length = Number(upstream.headers.get("content-length") ?? 0);
    if (length > 10 * 1024 * 1024) return new Response("Image too large", { status: 413 });
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Image unavailable", { status: 504 });
  }
}
