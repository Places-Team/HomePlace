import { NextResponse } from "next/server";
import { discoverMedia } from "@/lib/media";
import { linkMediaAccess, mediaLocale } from "@/lib/linkMediaAccess";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await linkMediaAccess(request);
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rate = checkDeviceActionRateLimit(access.userId, "media-discover", 40);
  if (!rate.allowed) return NextResponse.json({ error: "too many searches" }, {
    status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) },
  });
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim().slice(0, 120);
  const kind = params.get("kind");
  const category = params.get("category") === "anime" ? "anime" : "all";
  const page = Number(params.get("page") ?? 1);
  if (query && query.length < 2) return NextResponse.json({ error: "query is too short" }, { status: 400 });
  if (!Number.isInteger(page) || page < 1 || page > 100) return NextResponse.json({ error: "invalid page" }, { status: 400 });
  const locale = mediaLocale(params.get("lang"), access.locale);
  const result = await discoverMedia({
    query, kind: kind === "movie" || kind === "tv" ? kind : "all", category, page, locale,
  });
  return NextResponse.json({ ...result, locale }, { headers: { "cache-control": "private, no-store" } });
}
