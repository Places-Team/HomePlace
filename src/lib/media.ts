import "server-only";

import { limitedJson } from "./outbound";
import { readCachedJson, writeCachedJson } from "./mediaCache";
import {
  jellyfinAuthHeaders,
  jellyfinConfig,
  jellyfinServerUrl,
  overseerrConfig,
  qbitConfig,
} from "./services";

export type MediaKind = "movie" | "tv";
export type MediaCard = {
  id: number;
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  overview: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  rating?: number;
  popularity?: number;
  status:
    | "available"
    | "partially-available"
    | "requested"
    | "pending"
    | "missing";
  requestId?: number;
};

export type MediaDetailsData = MediaCard & {
  genres: string[];
  runtimeMinutes?: number;
  tagline?: string;
  releaseStatus?: string;
  studios: string[];
  seasons: {
    number: number;
    name: string;
    episodeCount: number;
    airDate?: string;
  }[];
};

export type MediaQualityProfile = {
  key: string;
  label: string;
  serverId: number;
  profileId: number;
  rootFolder?: string;
  is4k: boolean;
};

export type MediaRequest = {
  id: number;
  title: string;
  kind: MediaKind;
  status: string;
  requestedBy: string;
  createdAt: string;
  poster?: string;
};

export type JellyfinLibraryItem = {
  id: string;
  title: string;
  kind: MediaKind;
  year?: number;
  overview: string;
  poster?: string;
  played: boolean;
  progress: number;
  lastPlayedAt?: string;
};

export type JellyfinProfile = { id: string; name: string };

const jellyfinUserQuery = (userId?: string) =>
  userId ? `&UserId=${encodeURIComponent(userId)}` : "";
const jellyfinItemsPath = (userId: string | undefined, query: string) =>
  userId
    ? `/Users/${encodeURIComponent(userId)}/Items?${query}`
    : `/Items?${query}`;

export async function jellyfinProfiles(): Promise<JellyfinProfile[]> {
  const cfg = await jellyfinConfig();
  if (!cfg) return [];
  const serverUrl = await jellyfinServerUrl(cfg);
  try {
    const response = await fetch(`${serverUrl}/Users`, {
      headers: jellyfinAuthHeaders(cfg.apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];
    const payload = await limitedJson<Record<string, unknown>[]>(response);
    return (Array.isArray(payload) ? payload : [])
      .map((profile) => ({
        id: String(profile.Id ?? ""),
        name: String(profile.Name ?? ""),
      }))
      .filter((profile) => profile.id && profile.name);
  } catch {
    return [];
  }
}

export type JellyfinEpisode = {
  id: string;
  seasonId: string;
  title: string;
  number?: number;
  overview: string;
  runtimeMinutes?: number;
  played: boolean;
  progress: number;
};

export type JellyfinSeason = {
  id: string;
  title: string;
  number?: number;
  played: boolean;
  episodeCount: number;
  unplayedCount: number;
};

export type JellyfinDetails = JellyfinLibraryItem & {
  rating?: number;
  officialRating?: string;
  runtimeMinutes?: number;
  genres: string[];
  studios: string[];
  people: { name: string; role: string }[];
  seasons: JellyfinSeason[];
  episodes: JellyfinEpisode[];
};

export type DownloadItem = {
  hash: string;
  name: string;
  progress: number;
  state: string;
  downloadSpeed: number;
  uploadSpeed: number;
  eta: number;
  size: number;
  category: string;
};

const tmdbImage = (path: unknown, size: "w500" | "original") =>
  typeof path === "string" && path
    ? `/api/media/tmdb-image?size=${size}&path=${encodeURIComponent(path)}`
    : undefined;

function requestStatus(raw: Record<string, any>): MediaCard["status"] {
  const media = raw.mediaInfo ?? raw.media ?? {};
  const status = Number(media.status ?? 1);
  if (status === 5) return "available";
  if (status === 4) return "partially-available";
  if (status === 2 || status === 3) return "requested";
  const request = raw.request ?? raw.requests?.[0] ?? media.requests?.[0];
  if (request) return Number(request.status) === 1 ? "pending" : "requested";
  return "missing";
}

function normalizeMedia(raw: Record<string, any>): MediaCard | null {
  const kind: MediaKind = raw.mediaType === "tv" || raw.name ? "tv" : "movie";
  const id = Number(raw.id ?? raw.mediaId ?? raw.tmdbId);
  const title = String(raw.title ?? raw.name ?? "").trim();
  if (!id || !title) return null;
  const date = String(raw.releaseDate ?? raw.firstAirDate ?? "");
  const request =
    raw.request ?? raw.requests?.[0] ?? raw.mediaInfo?.requests?.[0];
  return {
    id,
    kind,
    title,
    originalTitle: raw.originalTitle ?? raw.originalName ?? undefined,
    overview: String(raw.overview ?? "").slice(0, 1200),
    poster: tmdbImage(raw.posterPath, "w500"),
    backdrop: tmdbImage(raw.backdropPath, "original"),
    year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined,
    rating: Number(raw.voteAverage ?? 0) || undefined,
    popularity: Number(raw.popularity ?? 0) || undefined,
    status: requestStatus(raw),
    requestId: Number(request?.id) || undefined,
  };
}

async function overseerrGet(path: string): Promise<Record<string, any> | null> {
  const cfg = await overseerrConfig();
  if (!cfg) return null;
  try {
    const response = await fetch(`${cfg.url}/api/v1${path}`, {
      headers: { "x-api-key": cfg.apiKey },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return await limitedJson<Record<string, any>>(response);
  } catch {
    return null;
  }
}

async function overseerrGetValue(path: string): Promise<any | null> {
  const cfg = await overseerrConfig();
  if (!cfg) return null;
  try {
    const response = await fetch(`${cfg.url}/api/v1${path}`, {
      headers: { "x-api-key": cfg.apiKey },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? await limitedJson<any>(response) : null;
  } catch {
    return null;
  }
}

export async function mediaQualityProfiles(
  kind: MediaKind,
): Promise<MediaQualityProfile[]> {
  const service = kind === "tv" ? "sonarr" : "radarr";
  const payload = await overseerrGetValue(`/settings/${service}`);
  const servers = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : [];
  const choices: MediaQualityProfile[] = [];
  for (const server of servers.slice(0, 20)) {
    const serverId = Number(server?.id);
    if (!Number.isInteger(serverId) || serverId < 0) continue;
    const detail = await overseerrGetValue(
      `/settings/${service}/${serverId}/profiles`,
    );
    const source = server;
    const profiles =
      [
        detail,
        detail?.profiles,
        source?.profiles,
        source?.qualityProfiles,
      ].find(Array.isArray) ?? [];
    const roots =
      [source?.rootFolders, source?.directories].find(Array.isArray) ?? [];
    const defaultRoot =
      String(
        source?.activeDirectory ?? source?.rootFolder ?? roots[0]?.path ?? "",
      ).trim() || undefined;
    const serverName = String(
      source?.name ?? server?.name ?? (kind === "tv" ? "Sonarr" : "Radarr"),
    );
    const server4k = !!(source?.is4k ?? server?.is4k);
    if (profiles.length) {
      for (const profile of profiles.slice(0, 50)) {
        const profileId = Number(profile?.id ?? profile?.profileId);
        if (!Number.isInteger(profileId) || profileId < 1) continue;
        const profileName = String(
          profile?.name ?? profile?.label ?? `Profile ${profileId}`,
        );
        choices.push({
          key: `${serverId}:${profileId}`,
          label: `${serverName} · ${profileName}${server4k ? " · 4K" : ""}`,
          serverId,
          profileId,
          rootFolder: defaultRoot,
          is4k: server4k,
        });
      }
    } else {
      const profileId = Number(
        source?.activeProfileId ??
          server?.activeProfileId ??
          source?.profileId ??
          server?.profileId,
      );
      if (Number.isInteger(profileId) && profileId > 0)
        choices.push({
          key: `${serverId}:${profileId}`,
          label: `${serverName}${server4k ? " · 4K" : " · default"}`,
          serverId,
          profileId,
          rootFolder: defaultRoot,
          is4k: server4k,
        });
    }
  }
  return choices.filter(
    (choice, index, all) =>
      all.findIndex((item) => item.key === choice.key) === index,
  );
}

export async function discoverMedia(
  options: {
    query?: string;
    kind?: "all" | MediaKind;
    page?: number;
  } = {},
): Promise<{
  configured: boolean;
  page: number;
  pages: number;
  items: MediaCard[];
}> {
  const configured = !!(await overseerrConfig());
  if (!configured) return { configured: false, page: 1, pages: 1, items: [] };
  const page = Math.max(1, Math.min(100, Number(options.page) || 1));
  const query = options.query?.trim().slice(0, 120);
  const kind = options.kind ?? "all";
  const path = query
    ? `/search?query=${encodeURIComponent(query)}&page=${page}`
    : kind === "movie"
      ? `/discover/movies?page=${page}`
      : kind === "tv"
        ? `/discover/tv?page=${page}`
        : `/discover/trending?page=${page}`;
  const payload = await overseerrGet(path);
  const items = (Array.isArray(payload?.results) ? payload.results : [])
    .map(normalizeMedia)
    .filter((item): item is MediaCard => !!item)
    .filter((item) => kind === "all" || item.kind === kind);
  return {
    configured: true,
    page: Number(payload?.page ?? page),
    pages: Math.min(100, Number(payload?.totalPages ?? page)),
    items,
  };
}

export async function discoverMediaDetails(
  kind: MediaKind,
  id: number,
): Promise<MediaDetailsData | null> {
  const mediaId = Math.floor(Number(id));
  if (!mediaId || mediaId < 1) return null;
  const cfg = await overseerrConfig();
  if (!cfg) return null;
  const cacheKey = `overseerr-${kind}-${mediaId}`;
  const jellyfin = await jellyfinConfig();
  if (jellyfin?.cacheLocally) {
    const cached = await readCachedJson<MediaDetailsData>(
      cacheKey,
      24 * 60 * 60_000,
    );
    if (cached) return cached;
  }
  const raw = await overseerrGet(
    `/${kind === "tv" ? "tv" : "movie"}/${mediaId}`,
  );
  if (!raw) return null;
  const base = normalizeMedia({ ...raw, id: mediaId, mediaType: kind });
  if (!base) return null;
  const details: MediaDetailsData = {
    ...base,
    overview: String(raw.overview ?? base.overview).slice(0, 5000),
    tagline: String(raw.tagline ?? "").trim() || undefined,
    releaseStatus: String(raw.status ?? "").trim() || undefined,
    runtimeMinutes: Number(raw.runtime ?? raw.episodeRunTime?.[0]) || undefined,
    genres: (Array.isArray(raw.genres) ? raw.genres : [])
      .map((genre: any) => String(genre?.name ?? genre))
      .filter(Boolean)
      .slice(0, 16),
    studios: (Array.isArray(raw.productionCompanies ?? raw.networks)
      ? (raw.productionCompanies ?? raw.networks)
      : []
    )
      .map((studio: any) => String(studio?.name ?? studio))
      .filter(Boolean)
      .slice(0, 10),
    seasons: (Array.isArray(raw.seasons) ? raw.seasons : [])
      .map((season: any) => ({
        number: Number(season.seasonNumber),
        name: String(season.name ?? ""),
        episodeCount: Number(season.episodeCount ?? 0),
        airDate: String(season.airDate ?? "") || undefined,
      }))
      .filter((season) => Number.isInteger(season.number) && season.number > 0),
  };
  if (jellyfin?.cacheLocally)
    await writeCachedJson(cacheKey, details).catch(() => undefined);
  return details;
}

export async function listMediaRequests(): Promise<MediaRequest[]> {
  const payload = await overseerrGet("/request?take=50&skip=0&sort=added");
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map((raw: Record<string, any>) => {
    const media = raw.media ?? {};
    return {
      id: Number(raw.id),
      title: String(media.title ?? media.name ?? raw.title ?? "Untitled"),
      kind: media.mediaType === "tv" ? "tv" : "movie",
      status:
        ["pending", "approved", "declined"][
          Math.max(0, Number(raw.status ?? 1) - 1)
        ] ?? "unknown",
      requestedBy: String(
        raw.requestedBy?.displayName ?? raw.requestedBy?.email ?? "HomePlace",
      ),
      createdAt: String(raw.createdAt ?? ""),
      poster: tmdbImage(media.posterPath, "w500"),
    };
  });
}

export async function createMediaRequest(input: {
  kind: MediaKind;
  mediaId: number;
  seasons?: number[];
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cfg = await overseerrConfig();
  if (!cfg) return { ok: false, error: "Overseerr is not configured" };
  const mediaId = Math.floor(Number(input.mediaId));
  if (!mediaId || mediaId < 1) return { ok: false, error: "Invalid media id" };
  const body: Record<string, unknown> = {
    mediaType: input.kind,
    mediaId,
    is4k: !!input.is4k,
  };
  if (Number.isInteger(input.serverId) && Number(input.serverId) >= 0)
    body.serverId = Number(input.serverId);
  if (Number.isInteger(input.profileId) && Number(input.profileId) > 0)
    body.profileId = Number(input.profileId);
  if (input.rootFolder?.trim())
    body.rootFolder = input.rootFolder.trim().slice(0, 500);
  if (input.kind === "tv")
    body.seasons =
      input.seasons?.filter((n) => Number.isInteger(n) && n > 0) ?? "all";
  try {
    const response = await fetch(`${cfg.url}/api/v1/request`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return { ok: true };
    const detail = await limitedJson<{ message?: string }>(response).catch(
      () => null,
    );
    return {
      ok: false,
      error: detail?.message ?? `Overseerr returned HTTP ${response.status}`,
    };
  } catch {
    return { ok: false, error: "Overseerr did not respond" };
  }
}

export async function deleteMediaRequest(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await overseerrConfig();
  if (!cfg || !Number.isInteger(id) || id < 1)
    return { ok: false, error: "Invalid request" };
  try {
    const response = await fetch(`${cfg.url}/api/v1/request/${id}`, {
      method: "DELETE",
      headers: { "x-api-key": cfg.apiKey },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    return response.ok
      ? { ok: true }
      : { ok: false, error: `Overseerr returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "Overseerr did not respond" };
  }
}

export async function updateMediaRequest(
  id: number,
  decision: "approve" | "decline",
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await overseerrConfig();
  if (!cfg || !Number.isInteger(id) || id < 1)
    return { ok: false, error: "Invalid request" };
  try {
    const response = await fetch(
      `${cfg.url}/api/v1/request/${id}/${decision}`,
      {
        method: "POST",
        headers: { "x-api-key": cfg.apiKey },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      },
    );
    return response.ok
      ? { ok: true }
      : { ok: false, error: `Overseerr returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "Overseerr did not respond" };
  }
}

export async function jellyfinLibrary(
  userId?: string,
): Promise<{ configured: boolean; items: JellyfinLibraryItem[] }> {
  const cfg = await jellyfinConfig();
  if (!cfg) return { configured: false, items: [] };
  const serverUrl = await jellyfinServerUrl(cfg);
  try {
    const fields = "Overview,ProductionYear,UserData,PrimaryImageAspectRatio";
    const response = await fetch(
      `${serverUrl}${jellyfinItemsPath(userId, `Recursive=true&IncludeItemTypes=Movie,Series&SortBy=DateCreated&SortOrder=Descending&Limit=100&Fields=${fields}`)}`,
      {
        headers: jellyfinAuthHeaders(cfg.apiKey),
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) return { configured: true, items: [] };
    const payload = await limitedJson<{ Items?: Record<string, any>[] }>(
      response,
    );
    return {
      configured: true,
      items: (payload.Items ?? []).map((raw) => ({
        id: String(raw.Id),
        title: String(raw.Name ?? "Untitled"),
        kind: raw.Type === "Series" ? "tv" : "movie",
        year: Number(raw.ProductionYear) || undefined,
        overview: String(raw.Overview ?? "").slice(0, 1200),
        poster: raw.Id
          ? `/api/media/jellyfin-image/${encodeURIComponent(String(raw.Id))}`
          : undefined,
        played: !!raw.UserData?.Played,
        lastPlayedAt:
          typeof raw.UserData?.LastPlayedDate === "string"
            ? raw.UserData.LastPlayedDate
            : undefined,
        progress:
          raw.RunTimeTicks && raw.UserData?.PlaybackPositionTicks
            ? (Number(raw.UserData.PlaybackPositionTicks) /
                Number(raw.RunTimeTicks)) *
              100
            : 0,
      })),
    };
  } catch {
    return { configured: true, items: [] };
  }
}

export async function jellyfinPlayedItems(
  userId?: string,
): Promise<JellyfinLibraryItem[]> {
  const cfg = await jellyfinConfig();
  if (!cfg) return [];
  const serverUrl = await jellyfinServerUrl(cfg);
  try {
    const fields = "Overview,ProductionYear,UserData,PrimaryImageAspectRatio";
    const response = await fetch(
      `${serverUrl}${jellyfinItemsPath(userId, `Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=5000&Fields=${fields}`)}`,
      {
        headers: jellyfinAuthHeaders(cfg.apiKey),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) return [];
    const payload = await limitedJson<{ Items?: Record<string, any>[] }>(
      response,
    );
    const items = (Array.isArray(payload.Items) ? payload.Items : [])
      .filter((raw) => !!raw.UserData?.Played)
      .map((raw) => ({
        id: String(
          raw.Type === "Episode"
            ? (raw.SeriesId ?? raw.ParentId ?? raw.Id)
            : raw.Id,
        ),
        title: String(
          raw.Type === "Episode"
            ? (raw.SeriesName ?? raw.Name ?? "Untitled")
            : (raw.Name ?? "Untitled"),
        ),
        kind: raw.Type === "Episode" ? ("tv" as const) : ("movie" as const),
        year: Number(raw.ProductionYear) || undefined,
        overview: String(raw.Overview ?? "").slice(0, 1200),
        poster: `/api/media/jellyfin-image/${encodeURIComponent(String(raw.Type === "Episode" ? (raw.SeriesId ?? raw.ParentId ?? raw.Id) : raw.Id))}`,
        played: true,
        progress: 100,
        lastPlayedAt:
          typeof raw.UserData?.LastPlayedDate === "string"
            ? raw.UserData.LastPlayedDate
            : undefined,
      }));
    return [...new Map(items.map((item) => [item.id, item])).values()];
  } catch {
    return [];
  }
}

export async function jellyfinDetails(
  id: string,
  userId?: string,
): Promise<JellyfinDetails | null> {
  const itemId = id.trim();
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(itemId)) return null;
  const cfg = await jellyfinConfig();
  if (!cfg) return null;
  const cacheKey = `jellyfin-details-${userId ?? "shared"}-${itemId}`;
  if (cfg.cacheLocally) {
    const cached = await readCachedJson<JellyfinDetails>(cacheKey, 10 * 60_000);
    if (cached) return cached;
  }
  const serverUrl = await jellyfinServerUrl(cfg);
  const headers = jellyfinAuthHeaders(cfg.apiKey);
  const fields =
    "Overview,ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,Genres,Studios,People,UserData";

  try {
    const itemResponse = await fetch(
      `${serverUrl}/Items?Ids=${encodeURIComponent(itemId)}&Recursive=true&Limit=1&Fields=${fields}${jellyfinUserQuery(userId)}`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!itemResponse.ok) return null;
    const itemPayload = await limitedJson<{ Items?: Record<string, any>[] }>(
      itemResponse,
    );
    const raw = Array.isArray(itemPayload.Items) ? itemPayload.Items[0] : null;
    if (!raw) return null;
    const isSeries = raw.Type === "Series";

    let seasonRows: Record<string, any>[] = [];
    let episodeRows: Record<string, any>[] = [];
    if (isSeries) {
      const [seasonResponse, episodeResponse] = await Promise.all([
        fetch(
          `${serverUrl}/Shows/${encodeURIComponent(itemId)}/Seasons?Fields=UserData${jellyfinUserQuery(userId)}`,
          {
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          },
        ),
        fetch(
          `${serverUrl}/Shows/${encodeURIComponent(itemId)}/Episodes?Fields=Overview,RunTimeTicks,UserData&Limit=500${jellyfinUserQuery(userId)}`,
          {
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(12000),
          },
        ),
      ]);
      if (seasonResponse.ok) {
        const payload = await limitedJson<{ Items?: Record<string, any>[] }>(
          seasonResponse,
        );
        seasonRows = Array.isArray(payload.Items) ? payload.Items : [];
      }
      if (episodeResponse.ok) {
        const payload = await limitedJson<{ Items?: Record<string, any>[] }>(
          episodeResponse,
        );
        episodeRows = Array.isArray(payload.Items) ? payload.Items : [];
      }
    }

    const runtime = Number(raw.RunTimeTicks ?? 0);
    const position = Number(raw.UserData?.PlaybackPositionTicks ?? 0);
    const episodes: JellyfinEpisode[] = episodeRows
      .map((episode) => {
        const episodeRuntime = Number(episode.RunTimeTicks ?? 0);
        const episodePosition = Number(
          episode.UserData?.PlaybackPositionTicks ?? 0,
        );
        return {
          id: String(episode.Id ?? ""),
          seasonId: String(episode.SeasonId ?? episode.ParentId ?? ""),
          title: String(episode.Name ?? "").trim(),
          number: Number.isFinite(Number(episode.IndexNumber))
            ? Number(episode.IndexNumber)
            : undefined,
          overview: String(episode.Overview ?? "").slice(0, 1200),
          runtimeMinutes:
            episodeRuntime > 0
              ? Math.round(episodeRuntime / 600_000_000)
              : undefined,
          played: !!episode.UserData?.Played,
          progress:
            episodeRuntime > 0 && episodePosition > 0
              ? (episodePosition / episodeRuntime) * 100
              : 0,
        };
      })
      .filter((episode) => episode.id && episode.title);

    const details: JellyfinDetails = {
      id: String(raw.Id ?? itemId),
      title: String(raw.Name ?? "").trim(),
      kind: isSeries ? "tv" : "movie",
      year: Number(raw.ProductionYear) || undefined,
      overview: String(raw.Overview ?? "").slice(0, 5000),
      poster: `/api/media/jellyfin-image/${encodeURIComponent(String(raw.Id ?? itemId))}`,
      played: !!raw.UserData?.Played,
      progress: runtime > 0 && position > 0 ? (position / runtime) * 100 : 0,
      rating: Number(raw.CommunityRating) || undefined,
      officialRating: String(raw.OfficialRating ?? "").trim() || undefined,
      runtimeMinutes:
        runtime > 0 ? Math.round(runtime / 600_000_000) : undefined,
      genres: (Array.isArray(raw.Genres) ? raw.Genres : [])
        .map(String)
        .filter(Boolean)
        .slice(0, 12),
      studios: (Array.isArray(raw.Studios) ? raw.Studios : [])
        .map((studio: any) => String(studio?.Name ?? studio))
        .filter(Boolean)
        .slice(0, 6),
      people: (Array.isArray(raw.People) ? raw.People : [])
        .filter((person: any) => person?.Name)
        .slice(0, 12)
        .map((person: any) => ({
          name: String(person.Name),
          role: String(person.Role ?? person.Type ?? ""),
        })),
      seasons: seasonRows
        .map((season) => ({
          id: String(season.Id ?? ""),
          title: String(season.Name ?? "").trim(),
          number: Number.isFinite(Number(season.IndexNumber))
            ? Number(season.IndexNumber)
            : undefined,
          played: !!season.UserData?.Played,
          episodeCount:
            Number(season.UserData?.PlayedPercentage) === 100
              ? episodes.filter(
                  (episode) => episode.seasonId === String(season.Id),
                ).length
              : Number(
                  season.ChildCount ??
                    episodes.filter(
                      (episode) => episode.seasonId === String(season.Id),
                    ).length,
                ),
          unplayedCount: Number(season.UserData?.UnplayedItemCount ?? 0),
        }))
        .filter((season) => season.id && season.title),
      episodes,
    };
    if (cfg.cacheLocally)
      await writeCachedJson(cacheKey, details).catch(() => undefined);
    return details;
  } catch {
    return null;
  }
}

async function qbitSession(): Promise<{
  cfg: NonNullable<Awaited<ReturnType<typeof qbitConfig>>>;
  cookie: string;
} | null> {
  const cfg = await qbitConfig();
  if (!cfg) return null;
  try {
    const login = await fetch(`${cfg.url}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: cfg.url,
      },
      body: new URLSearchParams({
        username: cfg.username,
        password: cfg.password,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    return login.ok && cookie ? { cfg, cookie } : null;
  } catch {
    return null;
  }
}

export async function listDownloads(): Promise<{
  configured: boolean;
  items: DownloadItem[];
}> {
  const session = await qbitSession();
  if (!session) return { configured: !!(await qbitConfig()), items: [] };
  try {
    const response = await fetch(
      `${session.cfg.url}/api/v2/torrents/info?sort=added_on&reverse=true&limit=100`,
      {
        headers: { cookie: session.cookie, referer: session.cfg.url },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return { configured: true, items: [] };
    const payload = await limitedJson<Record<string, any>[]>(response);
    return {
      configured: true,
      items: payload.map((raw) => ({
        hash: String(raw.hash ?? ""),
        name: String(raw.name ?? "Untitled"),
        progress: Number(raw.progress ?? 0) * 100,
        state: String(raw.state ?? "unknown"),
        downloadSpeed: Number(raw.dlspeed ?? 0),
        uploadSpeed: Number(raw.upspeed ?? 0),
        eta: Number(raw.eta ?? 0),
        size: Number(raw.size ?? 0),
        category: String(raw.category ?? ""),
      })),
    };
  } catch {
    return { configured: true, items: [] };
  }
}

export async function controlDownload(
  hash: string,
  action: "pause" | "resume" | "recheck" | "delete",
  deleteFiles = false,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[a-f0-9]{40}$/i.test(hash))
    return { ok: false, error: "Invalid torrent hash" };
  const session = await qbitSession();
  if (!session) return { ok: false, error: "qBittorrent is not available" };
  const endpoint =
    action === "pause" ? "stop" : action === "resume" ? "start" : action;
  const body = new URLSearchParams({ hashes: hash });
  if (action === "delete") body.set("deleteFiles", String(!!deleteFiles));
  try {
    let response = await fetch(
      `${session.cfg.url}/api/v2/torrents/${endpoint}`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          referer: session.cfg.url,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    // qBittorrent 5 renamed pause/resume to stop/start. Home servers often
    // update slowly, so retry the legacy name only when the new route is absent.
    if (
      response.status === 404 &&
      (action === "pause" || action === "resume")
    ) {
      response = await fetch(`${session.cfg.url}/api/v2/torrents/${action}`, {
        method: "POST",
        headers: {
          cookie: session.cookie,
          referer: session.cfg.url,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
    }
    return response.ok
      ? { ok: true }
      : { ok: false, error: `qBittorrent returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "qBittorrent did not respond" };
  }
}
