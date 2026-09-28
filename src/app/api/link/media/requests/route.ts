import { NextResponse } from "next/server";
import { listMediaRequests, createMediaRequest, mediaQualityProfiles } from "@/lib/media";
import { linkMediaAccess } from "@/lib/linkMediaAccess";
import { boundedJson, checkDeviceActionRateLimit } from "@/lib/linkRequest";
import { isSameOriginRequest } from "@/lib/security";
import { appUrl, settings } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await linkMediaAccess(request);
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ requests: await listMediaRequests() }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const access = await linkMediaAccess(request);
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (access.role !== "owner" && access.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!request.headers.has("authorization") && !isSameOriginRequest(request.headers, appUrl(), settings.trustProxyHeaders())) {
    return NextResponse.json({ error: "invalid request origin" }, { status: 403 });
  }
  const rate = checkDeviceActionRateLimit(access.userId, "media-request", 10);
  if (!rate.allowed) return NextResponse.json({ error: "too many media requests" }, { status: 429 });
  const body = await boundedJson(request);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid media request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const kind = input.kind === "movie" || input.kind === "tv" ? input.kind : null;
  const mediaId = Number(input.mediaId);
  if (!kind || !Number.isSafeInteger(mediaId) || mediaId < 1 || mediaId > 2_147_483_647) {
    return NextResponse.json({ error: "invalid media selection" }, { status: 400 });
  }
  const seasons = Array.isArray(input.seasons) ? input.seasons : undefined;
  if (seasons && (seasons.length > 100 || seasons.some((value) => !Number.isInteger(value) || Number(value) < 1 || Number(value) > 100))) {
    return NextResponse.json({ error: "invalid seasons" }, { status: 400 });
  }
  const profiles = await mediaQualityProfiles(kind);
  const profileKey = typeof input.profileKey === "string" ? input.profileKey : null;
  const profile = profileKey ? profiles.find((item) => item.key === profileKey) : undefined;
  if (profileKey && !profile) return NextResponse.json({ error: "quality profile unavailable" }, { status: 409 });
  const result = await createMediaRequest({
    kind, mediaId, seasons: seasons as number[] | undefined,
    ...(profile ? { serverId: profile.serverId, profileId: profile.profileId, rootFolder: profile.rootFolder, is4k: profile.is4k } : {}),
  });
  return NextResponse.json(result, { status: result.ok ? 201 : 409 });
}
