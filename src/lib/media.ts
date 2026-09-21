import "server-only";

import { limitedJson } from "./outbound";
import { jellyfinAuthHeaders, jellyfinConfig, jellyfinServerUrl, overseerrConfig, qbitConfig } from "./services";

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
  status: "available" | "partially-available" | "requested" | "pending" | "missing";
  requestId?: number;
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
  typeof path === "string" && path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

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
  const request = raw.request ?? raw.requests?.[0] ?? raw.mediaInfo?.requests?.[0];
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

export async function discoverMedia(options: {
  query?: string;
  kind?: "all" | MediaKind;
  page?: number;
} = {}): Promise<{ configured: boolean; page: number; pages: number; items: MediaCard[] }> {
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

export async function listMediaRequests(): Promise<MediaRequest[]> {
  const payload = await overseerrGet("/request?take=50&skip=0&sort=added");
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map((raw: Record<string, any>) => {
    const media = raw.media ?? {};
    return {
      id: Number(raw.id),
      title: String(media.title ?? media.name ?? raw.title ?? "Untitled"),
      kind: media.mediaType === "tv" ? "tv" : "movie",
      status: ["pending", "approved", "declined"][Math.max(0, Number(raw.status ?? 1) - 1)] ?? "unknown",
      requestedBy: String(raw.requestedBy?.displayName ?? raw.requestedBy?.email ?? "HomePlace"),
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
  if (input.kind === "tv") body.seasons = input.seasons?.filter((n) => Number.isInteger(n) && n > 0) ?? "all";
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
    const detail = await limitedJson<{ message?: string }>(response).catch(() => null);
    return { ok: false, error: detail?.message ?? `Overseerr returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "Overseerr did not respond" };
  }
}

export async function deleteMediaRequest(id: number): Promise<{ ok: boolean; error?: string }> {
  const cfg = await overseerrConfig();
  if (!cfg || !Number.isInteger(id) || id < 1) return { ok: false, error: "Invalid request" };
  try {
    const response = await fetch(`${cfg.url}/api/v1/request/${id}`, {
      method: "DELETE",
      headers: { "x-api-key": cfg.apiKey },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? { ok: true } : { ok: false, error: `Overseerr returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "Overseerr did not respond" };
  }
}

export async function updateMediaRequest(
  id: number,
  decision: "approve" | "decline"
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await overseerrConfig();
  if (!cfg || !Number.isInteger(id) || id < 1) return { ok: false, error: "Invalid request" };
  try {
    const response = await fetch(`${cfg.url}/api/v1/request/${id}/${decision}`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? { ok: true } : { ok: false, error: `Overseerr returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "Overseerr did not respond" };
  }
}

export async function jellyfinLibrary(): Promise<{ configured: boolean; items: JellyfinLibraryItem[] }> {
  const cfg = await jellyfinConfig();
  if (!cfg) return { configured: false, items: [] };
  const serverUrl = await jellyfinServerUrl(cfg);
  try {
    const fields = "Overview,ProductionYear,UserData,PrimaryImageAspectRatio";
    const response = await fetch(
      `${serverUrl}/Items?Recursive=true&IncludeItemTypes=Movie,Series&SortBy=DateCreated&SortOrder=Descending&Limit=100&Fields=${fields}`,
      { headers: jellyfinAuthHeaders(cfg.apiKey), cache: "no-store", signal: AbortSignal.timeout(12000) }
    );
    if (!response.ok) return { configured: true, items: [] };
    const payload = await limitedJson<{ Items?: Record<string, any>[] }>(response);
    return {
      configured: true,
      items: (payload.Items ?? []).map((raw) => ({
        id: String(raw.Id),
        title: String(raw.Name ?? "Untitled"),
        kind: raw.Type === "Series" ? "tv" : "movie",
        year: Number(raw.ProductionYear) || undefined,
        overview: String(raw.Overview ?? "").slice(0, 1200),
        poster: raw.Id ? `/api/media/jellyfin-image/${encodeURIComponent(String(raw.Id))}` : undefined,
        played: !!raw.UserData?.Played,
        progress:
          raw.RunTimeTicks && raw.UserData?.PlaybackPositionTicks
            ? (Number(raw.UserData.PlaybackPositionTicks) / Number(raw.RunTimeTicks)) * 100
            : 0,
      })),
    };
  } catch {
    return { configured: true, items: [] };
  }
}

async function qbitSession(): Promise<{ cfg: NonNullable<Awaited<ReturnType<typeof qbitConfig>>>; cookie: string } | null> {
  const cfg = await qbitConfig();
  if (!cfg) return null;
  try {
    const login = await fetch(`${cfg.url}/api/v2/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: cfg.url },
      body: new URLSearchParams({ username: cfg.username, password: cfg.password }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    return login.ok && cookie ? { cfg, cookie } : null;
  } catch {
    return null;
  }
}

export async function listDownloads(): Promise<{ configured: boolean; items: DownloadItem[] }> {
  const session = await qbitSession();
  if (!session) return { configured: !!(await qbitConfig()), items: [] };
  try {
    const response = await fetch(`${session.cfg.url}/api/v2/torrents/info?sort=added_on&reverse=true&limit=100`, {
      headers: { cookie: session.cookie, referer: session.cfg.url },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
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
  deleteFiles = false
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[a-f0-9]{40}$/i.test(hash)) return { ok: false, error: "Invalid torrent hash" };
  const session = await qbitSession();
  if (!session) return { ok: false, error: "qBittorrent is not available" };
  const endpoint = action === "pause" ? "stop" : action === "resume" ? "start" : action;
  const body = new URLSearchParams({ hashes: hash });
  if (action === "delete") body.set("deleteFiles", String(!!deleteFiles));
  try {
    let response = await fetch(`${session.cfg.url}/api/v2/torrents/${endpoint}`, {
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
    // qBittorrent 5 renamed pause/resume to stop/start. Home servers often
    // update slowly, so retry the legacy name only when the new route is absent.
    if (response.status === 404 && (action === "pause" || action === "resume")) {
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
    return response.ok ? { ok: true } : { ok: false, error: `qBittorrent returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "qBittorrent did not respond" };
  }
}
