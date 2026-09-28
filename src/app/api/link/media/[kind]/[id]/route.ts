import { NextResponse } from "next/server";
import { discoverMediaDetails, mediaQualityProfiles } from "@/lib/media";
import { linkMediaAccess, mediaLocale } from "@/lib/linkMediaAccess";
import { checkDeviceActionRateLimit } from "@/lib/linkRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  const access = await linkMediaAccess(request);
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { kind, id } = await context.params;
  if ((kind !== "movie" && kind !== "tv") || !/^[1-9]\d{0,9}$/.test(id)) {
    return NextResponse.json({ error: "invalid media id" }, { status: 400 });
  }
  const rate = checkDeviceActionRateLimit(access.userId, "media-details", 40);
  if (!rate.allowed) return NextResponse.json({ error: "too many detail requests" }, { status: 429 });
  const locale = mediaLocale(new URL(request.url).searchParams.get("lang"), access.locale);
  const [details, profiles] = await Promise.all([
    discoverMediaDetails(kind, Number(id), locale), mediaQualityProfiles(kind),
  ]);
  if (!details) return NextResponse.json({ error: "media details unavailable" }, { status: 404 });
  return NextResponse.json({ details, profiles, locale }, { headers: { "cache-control": "private, no-store" } });
}
