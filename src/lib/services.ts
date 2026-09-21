import "server-only";
import { Agent } from "undici";
import { getSetting, setSetting } from "./db";
import { decrypt, encrypt } from "./secretBox";
import { httpBaseUrl, limitedJson } from "./outbound";

/**
 * The services this household actually runs.
 *
 * A dashboard that only says "jellyfin: answering" is a bookmark with a light
 * on it. These read each service's own API and show what it is doing — what is
 * playing, what is downloading, when the last backup ran.
 *
 * Every one of them is optional, configured in the settings page, and stored
 * with its key encrypted. A failure returns null rather than throwing: a
 * service being down is exactly when the rest of the dashboard must still work.
 */

const KEY = {
  jellyfin: "integration.jellyfin",
  overseerr: "integration.overseerr",
  qbittorrent: "integration.qbittorrent",
  arr: "integration.arr",
  pbs: "integration.pbs",
  homeassistant: "integration.homeassistant",
};

/** Home labs use self-signed certificates; PBS in particular ships with one. */
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

type Fetch = { url: string; headers?: HeadersInit; insecure?: boolean; timeout?: number; init?: RequestInit };

async function get<T>({ url, headers, insecure, timeout = 8000, init }: Fetch): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
      // @ts-expect-error — undici's dispatcher option is not in the DOM types.
      dispatcher: insecure ? insecureAgent : undefined,
    });
    if (!res.ok) return null;
    return await limitedJson<T>(res);
  } catch {
    return null;
  }
}

const trim = (url: string) => {
  const normalized = httpBaseUrl(url);
  if (!normalized) throw new Error("invalid service address");
  return normalized;
};

// ──────────────────────────────── Jellyfin ───────────────────────────────

export type JellyfinSettings = {
  /** Public address used away from home. */
  url: string;
  /** Optional address reachable only on the home network. */
  localUrl?: string;
  /** Native client URL. `{id}` is replaced with the Jellyfin item id. */
  appUrl?: string;
  /** Persist artwork and metadata under /data/media-cache. */
  cacheLocally?: boolean;
  apiKey: string;
};
export type JellyfinItem = {
  id: string;
  name: string;
  /** "The Expanse · S02E04" — the line under the artwork. */
  detail: string;
  /** Poster URL, already signed with the API key so the browser can load it. */
  image: string;
  /** How far into it, for a resumable item. */
  progress: number;
  kind: string;
};

export type JellyfinState = {
  sessions: { user: string; item: string; kind: string; transcoding: boolean; progress: number }[];
  transcoding: number;
  counts: { movies: number; episodes: number; series: number };
  /** Half-watched things first, then the next unwatched episode of a series. */
  nextUp: JellyfinItem[];
  /** Recently added, for when nothing is half-watched. */
  recent: JellyfinItem[];
};

export async function jellyfinConfig(): Promise<JellyfinSettings | null> {
  const stored = await getSetting<JellyfinSettings | null>(KEY.jellyfin, null);
  if ((!stored?.url && !stored?.localUrl) || !stored.apiKey) return null;
  const url = stored.url ? httpBaseUrl(stored.url) : null;
  const localUrl = stored.localUrl ? httpBaseUrl(stored.localUrl) : null;
  return url || localUrl
    ? {
        url: url ?? "",
        localUrl: localUrl ?? undefined,
        appUrl: stored.appUrl?.trim() || undefined,
        cacheLocally: !!stored.cacheLocally,
        apiKey: await decrypt(stored.apiKey),
      }
    : null;
}

export async function saveJellyfin(input: JellyfinSettings | null): Promise<void> {
  jellyfinRouteCache = null;
  if (!input?.url && !input?.localUrl) return void (await setSetting(KEY.jellyfin, null));
  const existing = await getSetting<JellyfinSettings | null>(KEY.jellyfin, null);
  await setSetting(KEY.jellyfin, {
    url: input.url ? trim(input.url) : "",
    localUrl: input.localUrl ? trim(input.localUrl) : "",
    appUrl: input.appUrl?.trim().slice(0, 512) ?? "",
    cacheLocally: !!input.cacheLocally,
    apiKey: input.apiKey.trim() ? await encrypt(input.apiKey.trim()) : existing?.apiKey ?? "",
  });
}

/**
 * Server-to-server Jellyfin traffic should stay on the LAN whenever possible.
 * A public reverse-proxy address may work for browsers but fail from inside the
 * same network when the router does not support NAT loopback.
 */
let jellyfinRouteCache: { key: string; url: string; until: number } | null = null;

/**
 * Jellyfin 12 moved API-key authentication to the MediaBrowser Authorization
 * header. Keep X-Emby-Token alongside it for older Jellyfin installations.
 */
export function jellyfinAuthHeaders(apiKey: string): Record<string, string> {
  const token = apiKey.trim();
  return {
    authorization: `MediaBrowser Client="HomePlace", Device="Server", DeviceId="homeplace-server", Version="1.0", Token="${token}"`,
    "x-emby-token": token,
  };
}

export async function jellyfinServerUrl(config: JellyfinSettings): Promise<string> {
  const candidates = [config.localUrl, config.url].filter((url, index, all): url is string => !!url && all.indexOf(url) === index);
  const key = candidates.join("|");
  if (jellyfinRouteCache?.key === key && jellyfinRouteCache.until > Date.now()) return jellyfinRouteCache.url;

  const headers = jellyfinAuthHeaders(config.apiKey);
  for (const url of candidates) {
    const info = await get<Record<string, unknown>>({ url: `${url}/System/Info`, headers, timeout: 3000 });
    if (info) {
      jellyfinRouteCache = { key, url, until: Date.now() + 5 * 60_000 };
      return url;
    }
  }

  return candidates[0] ?? config.url;
}

// ─────────────────────────────── Overseerr ──────────────────────────────

export type OverseerrSettings = { url: string; apiKey: string };

export async function overseerrConfig(): Promise<OverseerrSettings | null> {
  const stored = await getSetting<OverseerrSettings | null>(KEY.overseerr, null);
  if (!stored?.url || !stored.apiKey) return null;
  const url = httpBaseUrl(stored.url);
  return url ? { url, apiKey: await decrypt(stored.apiKey) } : null;
}

export async function saveOverseerr(input: OverseerrSettings | null): Promise<void> {
  if (!input?.url) return void (await setSetting(KEY.overseerr, null));
  const existing = await getSetting<OverseerrSettings | null>(KEY.overseerr, null);
  await setSetting(KEY.overseerr, {
    url: trim(input.url),
    apiKey: input.apiKey.trim() ? await encrypt(input.apiKey.trim()) : existing?.apiKey ?? "",
  });
}

export async function overseerrAvailable(): Promise<boolean> {
  const cfg = await overseerrConfig();
  if (!cfg) return false;
  return !!(await get({ url: `${cfg.url}/api/v1/status`, headers: { "x-api-key": cfg.apiKey } }));
}

export type JellyfinConnectionProbe = {
  url: string;
  publicStatus: number;
  authenticatedStatus: number;
  sessionsStatus: number;
};

async function jellyfinStatus(url: string, path: string, apiKey?: string): Promise<number> {
  try {
    const response = await fetch(`${url}${path}`, {
      headers: apiKey ? jellyfinAuthHeaders(apiKey) : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

/** Safe connection diagnostics: statuses only, never credentials or bodies. */
export async function jellyfinConnectionProbes(): Promise<JellyfinConnectionProbe[]> {
  const cfg = await jellyfinConfig();
  if (!cfg) return [];
  const urls = [cfg.localUrl, cfg.url].filter((url, index, all): url is string => !!url && all.indexOf(url) === index);
  return Promise.all(urls.map(async (url) => {
    const [publicStatus, authenticatedStatus, sessionsStatus] = await Promise.all([
      jellyfinStatus(url, "/System/Info/Public"),
      jellyfinStatus(url, "/System/Info", cfg.apiKey),
      jellyfinStatus(url, "/Sessions", cfg.apiKey),
    ]);
    return { url, publicStatus, authenticatedStatus, sessionsStatus };
  }));
}

export async function jellyfinState(): Promise<JellyfinState | null> {
  const cfg = await jellyfinConfig();
  if (!cfg) return null;

  const serverUrl = await jellyfinServerUrl(cfg);
  const headers = jellyfinAuthHeaders(cfg.apiKey);

  // Four calls, in parallel: what is playing, how big the library is, what to
  // continue, and what has just arrived. A tile that only answers "is anything
  // playing" is blank most of the day, which is most of the time you look at it.
  const [sessions, counts, resume, nextUp, recent] = await Promise.all([
    get<Record<string, any>[]>({ url: `${serverUrl}/Sessions`, headers }),
    get<Record<string, number>>({ url: `${serverUrl}/Items/Counts`, headers }),
    get<{ Items?: Record<string, any>[] }>({
      url: `${serverUrl}/Items/Resume?Limit=8&MediaTypes=Video&Fields=SeriesName,IndexNumber,ParentIndexNumber`,
      headers,
    }),
    get<{ Items?: Record<string, any>[] }>({
      url: `${serverUrl}/Shows/NextUp?Limit=8&Fields=SeriesName,IndexNumber,ParentIndexNumber`,
      headers,
    }),
    get<{ Items?: Record<string, any>[] }>({
      url: `${serverUrl}/Items/Latest?Limit=8&IncludeItemTypes=Movie,Episode&Fields=SeriesName,IndexNumber,ParentIndexNumber`,
      headers,
    }),
  ]);
  if (!sessions) return null;

  const toItem = (raw: Record<string, any>): JellyfinItem => {
    const season = raw.ParentIndexNumber;
    const episode = raw.IndexNumber;
    const number =
      season !== undefined && episode !== undefined
        ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
        : "";
    const ticks = Number(raw.RunTimeTicks ?? 0);
    const position = Number(raw.UserData?.PlaybackPositionTicks ?? 0);

    return {
      id: String(raw.Id ?? ""),
      name: String(raw.SeriesName ?? raw.Name ?? ""),
      detail: [number, raw.SeriesName ? raw.Name : ""].filter(Boolean).join(" · "),
      // The key goes in the URL because the browser fetches the image directly
      // and cannot send a header; Jellyfin accepts it there for images.
      image: raw.Id ? `/api/media/jellyfin-image/${encodeURIComponent(String(raw.Id))}` : "",
      progress: ticks > 0 && position > 0 ? (position / ticks) * 100 : 0,
      kind: String(raw.Type ?? ""),
    };
  };

  // Resume first — a half-watched episode is more "next" than an unwatched one.
  const nextItems = [...(resume?.Items ?? []), ...(nextUp?.Items ?? [])]
    .filter((raw, i, all) => all.findIndex((other) => other.Id === raw.Id) === i)
    .slice(0, 8)
    .map(toItem);

  // Only sessions actually playing something: an idle app that is merely
  // connected is not "what is on".
  const playing = sessions.filter((s) => s.NowPlayingItem);

  return {
    sessions: playing.map((s) => ({
      user: String(s.UserName ?? ""),
      item: String(s.NowPlayingItem?.Name ?? ""),
      kind: String(s.NowPlayingItem?.Type ?? ""),
      transcoding: s.PlayState?.PlayMethod === "Transcode" || !!s.TranscodingInfo,
      progress:
        s.NowPlayingItem?.RunTimeTicks && s.PlayState?.PositionTicks
          ? (s.PlayState.PositionTicks / s.NowPlayingItem.RunTimeTicks) * 100
          : 0,
    })),
    transcoding: playing.filter((s) => s.PlayState?.PlayMethod === "Transcode" || s.TranscodingInfo).length,
    counts: {
      movies: counts?.MovieCount ?? 0,
      episodes: counts?.EpisodeCount ?? 0,
      series: counts?.SeriesCount ?? 0,
    },
    nextUp: nextItems,
    recent: (recent?.Items ?? []).map(toItem),
  };
}

// ────────────────────────────── qBittorrent ──────────────────────────────

export type QbitSettings = { url: string; username: string; password: string };
export type QbitState = {
  downloadSpeed: number;
  uploadSpeed: number;
  torrents: { name: string; progress: number; state: string; speed: number; eta: number }[];
  active: number;
  total: number;
};

export async function qbitConfig(): Promise<QbitSettings | null> {
  const stored = await getSetting<QbitSettings | null>(KEY.qbittorrent, null);
  if (!stored?.url) return null;
  const url = httpBaseUrl(stored.url);
  return url ? { url, username: stored.username ?? "", password: stored.password ? await decrypt(stored.password) : "" } : null;
}

export async function saveQbit(input: QbitSettings | null): Promise<void> {
  if (!input?.url) return void (await setSetting(KEY.qbittorrent, null));
  const existing = await getSetting<QbitSettings | null>(KEY.qbittorrent, null);
  await setSetting(KEY.qbittorrent, {
    url: trim(input.url),
    username: input.username?.trim() ?? "",
    password: input.password ? await encrypt(input.password) : existing?.password ?? "",
  });
}

/**
 * qBittorrent hands out a session cookie rather than taking an API key, so the
 * login is part of every read. The cookie is cached for a few minutes — logging
 * in on every dashboard refresh would show up in its log as a brute-force
 * attempt.
 */
let qbitCookie: { value: string; until: number } | null = null;

async function qbitLogin(cfg: QbitSettings): Promise<string | null> {
  if (qbitCookie && qbitCookie.until > Date.now()) return qbitCookie.value;

  try {
    const res = await fetch(`${cfg.url}/api/v2/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: cfg.url },
      body: new URLSearchParams({ username: cfg.username, password: cfg.password }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!res.ok || !cookie) return null;
    qbitCookie = { value: cookie, until: Date.now() + 5 * 60_000 };
    return cookie;
  } catch {
    return null;
  }
}

export async function qbitState(): Promise<QbitState | null> {
  const cfg = await qbitConfig();
  if (!cfg) return null;

  const cookie = await qbitLogin(cfg);
  if (!cookie) return null;
  const headers = { cookie, referer: cfg.url };

  const [transfer, torrents] = await Promise.all([
    get<Record<string, number>>({ url: `${cfg.url}/api/v2/transfer/info`, headers }),
    get<Record<string, any>[]>({ url: `${cfg.url}/api/v2/torrents/info?sort=dlspeed&reverse=true&limit=20`, headers }),
  ]);
  if (!transfer || !torrents) {
    // The cached cookie may have expired early; drop it so the next read logs
    // in again instead of failing forever.
    qbitCookie = null;
    return null;
  }

  const active = torrents.filter((t) => ["downloading", "uploading", "forcedDL", "forcedUP"].includes(String(t.state)));

  return {
    downloadSpeed: transfer.dl_info_speed ?? 0,
    uploadSpeed: transfer.up_info_speed ?? 0,
    active: active.length,
    total: torrents.length,
    torrents: torrents
      .filter((t) => Number(t.progress) < 1 || Number(t.dlspeed) > 0)
      .slice(0, 6)
      .map((t) => ({
        name: String(t.name ?? ""),
        progress: Number(t.progress ?? 0) * 100,
        state: String(t.state ?? ""),
        speed: Number(t.dlspeed ?? 0),
        eta: Number(t.eta ?? 0),
      })),
  };
}

// ─────────────────────────────────── *arr ────────────────────────────────

export type ArrInstance = { kind: string; label: string; url: string; apiKey: string };
export type ArrState = {
  label: string;
  kind: string;
  queue: { title: string; status: string; progress: number }[];
  queueCount: number;
  warnings: number;
  /** What is due in the next week — episodes airing or films releasing. */
  upcoming: { title: string; sub?: string; at: number }[];
};

export async function arrConfig(): Promise<ArrInstance[]> {
  const stored = await getSetting<ArrInstance[]>(KEY.arr, []);
  return Promise.all(
    stored
      .filter((a) => a?.url && a.kind && httpBaseUrl(a.url))
      .map(async (a) => ({ ...a, url: httpBaseUrl(a.url)!, apiKey: a.apiKey ? await decrypt(a.apiKey) : "" }))
  );
}

export async function saveArr(instances: ArrInstance[]): Promise<void> {
  const existing = await getSetting<ArrInstance[]>(KEY.arr, []);
  await setSetting(
    KEY.arr,
    await Promise.all(
      instances
        .filter((a) => a.url?.trim())
        .map(async (a, i) => ({
          kind: a.kind,
          label: a.label?.trim() || a.kind,
          url: trim(a.url),
          apiKey: a.apiKey ? await encrypt(a.apiKey) : existing[i]?.apiKey ?? "",
        }))
    )
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export async function arrState(): Promise<ArrState[]> {
  const instances = await arrConfig();
  const results = await Promise.all(
    instances.map(async (instance) => {
      const headers = { "x-api-key": instance.apiKey };
      const start = new Date().toISOString();
      const end = new Date(Date.now() + 7 * 86400_000).toISOString();
      const [queue, health, calendar] = await Promise.all([
        get<Record<string, any>>({ url: `${instance.url}/api/v3/queue?pageSize=20`, headers }),
        get<Record<string, any>[]>({ url: `${instance.url}/api/v3/health`, headers }),
        get<Record<string, any>[]>({
          url: `${instance.url}/api/v3/calendar?start=${start}&end=${end}&includeSeries=true`,
          headers,
        }),
      ]);
      if (!queue) return null;

      return {
        label: instance.label,
        kind: instance.kind,
        queueCount: Number(queue.totalRecords ?? queue.records?.length ?? 0),
        warnings: (health ?? []).filter((h) => h.type !== "ok").length,
        queue: (queue.records ?? []).slice(0, 5).map((r: Record<string, any>) => ({
          title: String(r.title ?? ""),
          status: String(r.status ?? ""),
          // Progress is reported as "how much is left", so it has to be turned
          // around to mean what the bar shows.
          progress: r.size > 0 ? ((r.size - (r.sizeleft ?? 0)) / r.size) * 100 : 0,
        })),
        upcoming: (calendar ?? [])
          .map((r: Record<string, any>) => {
            // A Sonarr episode carries a series and an air date; a Radarr film
            // carries its own title and a release date.
            if (r.series || r.seriesId) {
              const at = Date.parse(r.airDateUtc ?? r.airDate ?? "");
              const s = r.seasonNumber != null ? `S${pad(r.seasonNumber)}E${pad(r.episodeNumber)}` : undefined;
              return { title: String(r.series?.title ?? r.title ?? ""), sub: s, at };
            }
            const at = Date.parse(r.digitalRelease ?? r.physicalRelease ?? r.inCinemas ?? "");
            return { title: String(r.title ?? ""), at };
          })
          .filter((u) => u.title && Number.isFinite(u.at))
          .sort((a, b) => a.at - b.at)
          .slice(0, 6),
      };
    })
  );
  return results.filter((r): r is ArrState => r !== null);
}

export type ArrResult = {
  instanceLabel: string;
  kind: string;
  title: string;
  year?: number;
  poster?: string;
  overview?: string;
  inLibrary: boolean;
  /** tvdbId (Sonarr) or tmdbId (Radarr) — how the add is addressed. */
  externalId: number;
};

/** Search every Sonarr/Radarr instance's lookup for a title. */
export async function arrSearch(term: string): Promise<ArrResult[]> {
  if (!term.trim()) return [];
  const instances = await arrConfig();
  const out: ArrResult[] = [];

  await Promise.all(
    instances.map(async (inst) => {
      const isSonarr = /sonarr/i.test(inst.kind);
      const isRadarr = /radarr/i.test(inst.kind);
      if (!isSonarr && !isRadarr) return;
      const path = isSonarr ? "series" : "movie";
      const res = await get<Record<string, any>[]>({
        url: `${inst.url}/api/v3/${path}/lookup?term=${encodeURIComponent(term)}`,
        headers: { "x-api-key": inst.apiKey },
      });
      for (const r of (res ?? []).slice(0, 8)) {
        const poster = Array.isArray(r.images)
          ? r.images.find((im: Record<string, any>) => im.coverType === "poster")?.remoteUrl ?? r.images[0]?.remoteUrl
          : undefined;
        out.push({
          instanceLabel: inst.label,
          kind: inst.kind,
          title: String(r.title ?? ""),
          year: r.year || undefined,
          poster: poster ? String(poster) : undefined,
          overview: r.overview ? String(r.overview).slice(0, 240) : undefined,
          inLibrary: Number(r.id ?? 0) > 0,
          externalId: Number(isSonarr ? r.tvdbId : r.tmdbId) || 0,
        });
      }
    })
  );
  return out;
}

/**
 * Add a title to a Sonarr/Radarr library.
 *
 * The item is looked up again by its id, then handed back to the *arr with the
 * first quality profile and first root folder filled in — the defaults its own
 * "add" dialog would pre-select — and told to search for it. Anything more (a
 * chosen profile, a specific folder) belongs in the *arr itself.
 */
export async function arrAdd(instanceLabel: string, externalId: number): Promise<{ ok: boolean; error?: string }> {
  const inst = (await arrConfig()).find((i) => i.label === instanceLabel);
  if (!inst) return { ok: false, error: "unknown instance" };

  const isSonarr = /sonarr/i.test(inst.kind);
  const path = isSonarr ? "series" : "movie";
  const headers = { "x-api-key": inst.apiKey, "content-type": "application/json" };
  const term = isSonarr ? `tvdb:${externalId}` : `tmdb:${externalId}`;

  const results = await get<Record<string, any>[]>({
    url: `${inst.url}/api/v3/${path}/lookup?term=${encodeURIComponent(term)}`,
    headers,
  });
  const item = (results ?? [])[0];
  if (!item) return { ok: false, error: "not found" };
  if (Number(item.id ?? 0) > 0) return { ok: false, error: "already in the library" };

  const [profiles, folders] = await Promise.all([
    get<Record<string, any>[]>({ url: `${inst.url}/api/v3/qualityprofile`, headers }),
    get<Record<string, any>[]>({ url: `${inst.url}/api/v3/rootfolder`, headers }),
  ]);
  const qualityProfileId = profiles?.[0]?.id;
  const rootFolderPath = folders?.[0]?.path;
  if (!qualityProfileId || !rootFolderPath) return { ok: false, error: "no quality profile or root folder is set up" };

  const payload = {
    ...item,
    qualityProfileId,
    rootFolderPath,
    monitored: true,
    addOptions: isSonarr ? { searchForMissingEpisodes: true } : { searchForMovie: true },
  };
  const res = await get<Record<string, any>>({
    url: `${inst.url}/api/v3/${path}`,
    headers,
    init: { method: "POST", body: JSON.stringify(payload) },
  });
  return res ? { ok: true } : { ok: false, error: "the request was rejected" };
}

// ─────────────────────────────────── PBS ─────────────────────────────────

export type PbsSettings = { url: string; tokenId: string; tokenSecret: string; verifyTls: boolean };
export type PbsState = {
  datastores: { name: string; total: number; used: number; avail: number }[];
  lastBackup: { group: string; at: number }[];
};

export async function pbsConfig(): Promise<PbsSettings | null> {
  const stored = await getSetting<PbsSettings | null>(KEY.pbs, null);
  if (!stored?.url || !stored.tokenId) return null;
  const url = httpBaseUrl(stored.url);
  return url ? { ...stored, url, tokenSecret: await decrypt(stored.tokenSecret) } : null;
}

export async function savePbs(input: PbsSettings | null): Promise<void> {
  if (!input?.url) return void (await setSetting(KEY.pbs, null));
  const existing = await getSetting<PbsSettings | null>(KEY.pbs, null);
  await setSetting(KEY.pbs, {
    url: trim(input.url),
    tokenId: input.tokenId.trim(),
    tokenSecret: input.tokenSecret ? await encrypt(input.tokenSecret) : existing?.tokenSecret ?? "",
    verifyTls: !!input.verifyTls,
  });
}

/**
 * Proxmox Backup Server: how full the datastores are, and when each group was
 * last backed up.
 *
 * "When did this last run" is the only backup question that matters day to day,
 * and it is the one a green container light cannot answer.
 */
export async function pbsState(): Promise<PbsState | null> {
  const cfg = await pbsConfig();
  if (!cfg) return null;

  const headers = { authorization: `PBSAPIToken=${cfg.tokenId}:${cfg.tokenSecret}` };
  const insecure = !cfg.verifyTls;

  const usage = await get<{ data: Record<string, any>[] }>({
    url: `${cfg.url}/api2/json/status/datastore-usage`,
    headers,
    insecure,
  });
  if (!usage) return null;

  const datastores = (usage.data ?? []).map((store) => ({
    name: String(store.store ?? ""),
    total: Number(store.total ?? 0),
    used: Number(store.used ?? 0),
    avail: Number(store.avail ?? 0),
  }));

  // The newest snapshot per group, across every datastore.
  const groups: { group: string; at: number }[] = [];
  for (const store of datastores) {
    const snapshots = await get<{ data: Record<string, any>[] }>({
      url: `${cfg.url}/api2/json/admin/datastore/${encodeURIComponent(store.name)}/groups`,
      headers,
      insecure,
    });
    for (const group of snapshots?.data ?? []) {
      groups.push({
        group: `${group["backup-type"]}/${group["backup-id"]}`,
        at: Number(group["last-backup"] ?? 0) * 1000,
      });
    }
  }

  return { datastores, lastBackup: groups.sort((a, b) => b.at - a.at).slice(0, 8) };
}

// ────────────────────────────── Home Assistant ───────────────────────────

export type HaSettings = { url: string; token: string };
export type HaEntity = {
  id: string;
  name: string;
  state: string;
  unit?: string;
  domain: string;
  toggleable: boolean;
  /** Room, when Home Assistant knows one. */
  area?: string;
  /** The physical device this entity belongs to — "Washing machine", "Archer
   *  AX53" — so a device's dozen sensors can be shown as one card. */
  device?: string;
  /**
   * Home Assistant's own classification of a sensor — "duration", "timestamp",
   * "data_size", "temperature"… It is what lets a raw number be shown as days
   * and hours, or a Unix time as "5 min ago", without anyone choosing a format
   * by hand.
   */
  deviceClass?: string;
  /** For a light that is on: its brightness as a percentage, for the dimmer. */
  brightness?: number;
  /** A colour light's current colour, "r,g,b", for the colour picker. */
  rgb?: string;
  /** Which of brightness / colour temperature / colour the light supports. */
  supportsColor?: boolean;
  supportsColorTemp?: boolean;
  /** Extra attributes worth showing: brightness, temperature, battery. */
  attributes?: Record<string, string>;
};

export async function haConfig(): Promise<HaSettings | null> {
  const stored = await getSetting<HaSettings | null>(KEY.homeassistant, null);
  if (!stored?.url || !stored.token) return null;
  const url = httpBaseUrl(stored.url);
  return url ? { url, token: await decrypt(stored.token) } : null;
}

export async function saveHa(input: HaSettings | null): Promise<void> {
  if (!input?.url) return void (await setSetting(KEY.homeassistant, null));
  const existing = await getSetting<HaSettings | null>(KEY.homeassistant, null);
  await setSetting(KEY.homeassistant, {
    url: trim(input.url),
    token: input.token ? await encrypt(input.token) : existing?.token ?? "",
  });
}

/**
 * Which room an entity is in.
 *
 * Home Assistant only exposes areas through its websocket API, which is a lot of
 * machinery for one label. The template endpoint answers the same question over
 * plain HTTP, and the answers are cached for a few minutes because furniture
 * does not move often.
 */
const areaCache = new Map<string, string>();
// Entity → physical device name. Filled by the same template call as areas, so
// grouping the smart-home page by device costs no extra request.
const deviceCache = new Map<string, string>();
let areasFetchedAt = 0;

export async function haAreas(): Promise<string[]> {
  const cfg = await haConfig();
  if (!cfg) return [];
  if (Date.now() - areasFetchedAt < 300_000 && areaCache.size > 0) {
    return [...new Set(areaCache.values())].sort();
  }

  try {
    const res = await fetch(`${cfg.url}/api/template`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      // One template renders entity → area and entity → device in a single call.
      // device_attr must not be called with a null id (it 400s), hence the guard.
      body: JSON.stringify({
        template:
          "{% for s in states %}{% set did = device_id(s.entity_id) %}" +
          "{{ s.entity_id }}|{{ area_name(s.entity_id) or '' }}|" +
          "{{ (device_attr(did, 'name_by_user') or device_attr(did, 'name')) if did else '' }}\n{% endfor %}",
      }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const text = await res.text();
    areaCache.clear();
    deviceCache.clear();
    for (const line of text.split("\n")) {
      const [id, area, device] = line.split("|");
      const eid = id?.trim();
      if (!eid) continue;
      if (area && area.trim() && area.trim() !== "None") areaCache.set(eid, area.trim());
      if (device && device.trim() && device.trim() !== "None") deviceCache.set(eid, device.trim());
    }
    areasFetchedAt = Date.now();
    return [...new Set(areaCache.values())].sort();
  } catch {
    return [];
  }
}

function areaOf(entityId: string): string | undefined {
  return areaCache.get(entityId);
}

function deviceOf(entityId: string): string | undefined {
  return deviceCache.get(entityId);
}

/**
 * The handful of attributes worth putting on a card.
 *
 * An entity can carry forty of them; showing all forty makes a wall of noise,
 * and showing none loses the brightness of a lamp and the battery of a sensor.
 */
function interesting(attributes: Record<string, any>): Record<string, string> {
  const keep = ["brightness", "current_temperature", "temperature", "humidity", "battery_level", "media_title"];
  const out: Record<string, string> = {};
  for (const key of keep) {
    if (attributes[key] !== undefined && attributes[key] !== null) out[key] = String(attributes[key]);
  }
  return out;
}

/** Domains a tile may switch. Everything else is read-only, deliberately. */
const TOGGLEABLE = new Set(["light", "switch", "input_boolean", "fan", "automation", "script", "scene"]);

export type HaCamera = { id: string; name: string; url: string };

/**
 * Camera entities and a snapshot URL for each.
 *
 * Home Assistant signs a snapshot URL into every camera's `entity_picture`
 * attribute (a token in the query string), so a plain <img> can show it without
 * a header — the same trick the Jellyfin posters use. The token rotates, so the
 * URL is re-fetched on each load; the widget cache-busts to pull a fresh frame.
 */
export async function haCameras(ids?: string[]): Promise<HaCamera[] | null> {
  const cfg = await haConfig();
  if (!cfg) return null;
  const all = await get<Record<string, any>[]>({ url: `${cfg.url}/api/states`, headers: { authorization: `Bearer ${cfg.token}` } });
  if (!all) return null;

  const wanted = ids && ids.length > 0 ? new Set(ids) : null;
  return all
    .filter((e) => String(e.entity_id).startsWith("camera.") && e.attributes?.entity_picture)
    .filter((e) => !wanted || wanted.has(String(e.entity_id)))
    .map((e) => ({
      id: String(e.entity_id),
      name: String(e.attributes?.friendly_name ?? e.entity_id),
      url: `${cfg.url}${e.attributes.entity_picture}`,
    }));
}

export async function haStates(ids?: string[]): Promise<HaEntity[] | null> {
  const cfg = await haConfig();
  if (!cfg) return null;

  const all = await get<Record<string, any>[]>({
    url: `${cfg.url}/api/states`,
    headers: { authorization: `Bearer ${cfg.token}` },
  });
  if (!all) return null;

  const wanted = ids && ids.length > 0 ? new Set(ids) : null;

  return all
    .filter((e) => !wanted || wanted.has(String(e.entity_id)))
    .map((e) => {
      const id = String(e.entity_id);
      const domain = id.split(".")[0];
      return {
        id,
        name: String(e.attributes?.friendly_name ?? id),
        state: String(e.state),
        unit: e.attributes?.unit_of_measurement ? String(e.attributes.unit_of_measurement) : undefined,
        domain,
        toggleable: TOGGLEABLE.has(domain),
        area: areaOf(id),
        device: deviceOf(id),
        deviceClass: e.attributes?.device_class ? String(e.attributes.device_class) : undefined,
        brightness:
          domain === "light" && e.attributes?.brightness != null
            ? Math.round((Number(e.attributes.brightness) / 255) * 100)
            : undefined,
        rgb:
          domain === "light" && Array.isArray(e.attributes?.rgb_color)
            ? (e.attributes.rgb_color as number[]).slice(0, 3).join(",")
            : undefined,
        supportsColor:
          domain === "light" &&
          Array.isArray(e.attributes?.supported_color_modes) &&
          (e.attributes.supported_color_modes as string[]).some((m) => ["rgb", "rgbw", "rgbww", "hs", "xy"].includes(m)),
        supportsColorTemp:
          domain === "light" &&
          Array.isArray(e.attributes?.supported_color_modes) &&
          (e.attributes.supported_color_modes as string[]).includes("color_temp"),
        attributes: interesting(e.attributes ?? {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type HaHistoryPoint = { state: string; at: string };

/**
 * One entity's recent history — the light going on and off, the sensor's
 * readings, the washing machine's run.
 *
 * Home Assistant keeps this in its recorder and hands it back over plain HTTP.
 * `minimal_response` and `significant_changes_only` keep it to the transitions
 * worth showing rather than every recorded sample, which is what makes it a
 * readable log instead of a wall of numbers.
 */
export async function haHistory(entityId: string, hours = 24): Promise<HaHistoryPoint[]> {
  const cfg = await haConfig();
  if (!cfg) return [];

  const start = new Date(Date.now() - hours * 3600_000).toISOString();
  try {
    const res = await fetch(
      `${cfg.url}/api/history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(
        entityId
      )}&minimal_response&significant_changes_only`,
      {
        headers: { authorization: `Bearer ${cfg.token}` },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return [];

    const data = (await res.json()) as Array<Array<{ state?: string; last_changed?: string; last_updated?: string }>>;
    const series = data[0] ?? [];
    return series
      .map((p) => ({ state: String(p.state ?? ""), at: String(p.last_changed ?? p.last_updated ?? "") }))
      .filter((p) => p.at && p.state && p.state !== "unavailable" && p.state !== "unknown")
      .reverse(); // newest first
  } catch {
    return [];
  }
}

/**
 * A media player, in full.
 *
 * Home Assistant already knows what is playing, on what, how loud and how far
 * through — everything a remote needs. Reading it here is what lets the panel be
 * the remote, instead of sending people back to Home Assistant for the one thing
 * they open it for most often.
 */
export type HaMediaPlayer = {
  id: string;
  name: string;
  state: string;
  title?: string;
  artist?: string;
  album?: string;
  /** Absolute URL of the cover art, ready for an <img>. */
  art?: string;
  volume?: number;
  muted?: boolean;
  /** Seconds. The position advances on its own from `positionAt`. */
  position?: number;
  duration?: number;
  positionAt?: number;
  source?: string;
  sources: string[];
  /** Shuffle and repeat, where the player has them. */
  shuffle?: boolean;
  repeat?: "off" | "all" | "one";
  /** Which buttons this player actually obeys, from its feature bitmask. */
  can: {
    pause: boolean;
    play: boolean;
    stop: boolean;
    next: boolean;
    previous: boolean;
    volumeSet: boolean;
    volumeMute: boolean;
    seek: boolean;
    selectSource: boolean;
    turnOn: boolean;
    turnOff: boolean;
    shuffle: boolean;
    repeat: boolean;
  };
};

/**
 * Capabilities arrive as a bitmask, and a remote offering a button the speaker
 * cannot obey is worse than one that hides it.
 * https://developers.home-assistant.io/docs/core/entity/media-player
 */
const MEDIA_FEATURES = {
  pause: 1,
  seek: 2,
  volumeSet: 4,
  volumeMute: 8,
  previous: 16,
  next: 32,
  turnOn: 128,
  turnOff: 256,
  selectSource: 2048,
  stop: 4096,
  play: 16384,
  shuffleSet: 32768,
  repeatSet: 262144,
};

export async function haMediaPlayers(ids?: string[]): Promise<HaMediaPlayer[] | null> {
  const cfg = await haConfig();
  if (!cfg) return null;

  const all = await get<Record<string, any>[]>({
    url: `${cfg.url}/api/states`,
    headers: { authorization: `Bearer ${cfg.token}` },
  });
  if (!all) return null;

  const wanted = ids && ids.length > 0 ? new Set(ids) : null;

  return all
    .filter((e) => String(e.entity_id).startsWith("media_player.") && (!wanted || wanted.has(String(e.entity_id))))
    .map((e) => {
      const a = e.attributes ?? {};
      const features = Number(a.supported_features ?? 0);
      const has = (bit: number) => (features & bit) !== 0;

      return {
        id: String(e.entity_id),
        name: String(a.friendly_name ?? e.entity_id),
        state: String(e.state ?? "unknown"),
        title: a.media_title ? String(a.media_title) : undefined,
        artist: a.media_artist ? String(a.media_artist) : undefined,
        album: a.media_album_name ? String(a.media_album_name) : undefined,
        // The picture is a path on the Home Assistant host and carries its own
        // signed token; the browser needs it absolute.
        art: a.entity_picture ? absoluteHaUrl(cfg.url, String(a.entity_picture)) : undefined,
        volume: a.volume_level === undefined ? undefined : Number(a.volume_level),
        muted: a.is_volume_muted === undefined ? undefined : Boolean(a.is_volume_muted),
        position: a.media_position === undefined ? undefined : Number(a.media_position),
        duration: a.media_duration === undefined ? undefined : Number(a.media_duration),
        positionAt: a.media_position_updated_at ? Date.parse(String(a.media_position_updated_at)) : undefined,
        source: a.source ? String(a.source) : undefined,
        sources: Array.isArray(a.source_list) ? a.source_list.map(String) : [],
        shuffle: a.shuffle === undefined ? undefined : Boolean(a.shuffle),
        repeat: a.repeat === "all" || a.repeat === "one" ? a.repeat : a.repeat === undefined ? undefined : "off",
        can: {
          pause: has(MEDIA_FEATURES.pause),
          play: has(MEDIA_FEATURES.play),
          stop: has(MEDIA_FEATURES.stop),
          next: has(MEDIA_FEATURES.next),
          previous: has(MEDIA_FEATURES.previous),
          volumeSet: has(MEDIA_FEATURES.volumeSet),
          volumeMute: has(MEDIA_FEATURES.volumeMute),
          seek: has(MEDIA_FEATURES.seek),
          selectSource: has(MEDIA_FEATURES.selectSource),
          turnOn: has(MEDIA_FEATURES.turnOn),
          turnOff: has(MEDIA_FEATURES.turnOff),
          shuffle: has(MEDIA_FEATURES.shuffleSet),
          repeat: has(MEDIA_FEATURES.repeatSet),
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function absoluteHaUrl(base: string, path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export type MediaCommand =
  | "play"
  | "pause"
  | "play_pause"
  | "stop"
  | "next"
  | "previous"
  | "volume_up"
  | "volume_down"
  | "mute"
  | "unmute"
  | "turn_on"
  | "turn_off"
  | "shuffle_on"
  | "shuffle_off"
  | "repeat_off"
  | "repeat_all"
  | "repeat_one";

/**
 * One command to one player.
 *
 * The allowlist is the boundary: this panel may be open on a kitchen tablet, and
 * "call any Home Assistant service with any payload" is not something it should
 * be able to do.
 */
export async function haMediaCommand(
  entityId: string,
  command: MediaCommand
): Promise<{ ok: boolean; error?: string }> {
  if (!entityId.startsWith("media_player.")) return { ok: false, error: "not a media player" };

  // Shuffle and repeat are one service each with a payload, rather than a
  // service per state — kept apart from the table for that reason.
  if (command === "shuffle_on" || command === "shuffle_off") {
    return haCall("media_player", "shuffle_set", { entity_id: entityId, shuffle: command === "shuffle_on" });
  }
  if (command === "repeat_off" || command === "repeat_all" || command === "repeat_one") {
    return haCall("media_player", "repeat_set", { entity_id: entityId, repeat: command.slice("repeat_".length) });
  }

  const services: Record<Exclude<MediaCommand, "shuffle_on" | "shuffle_off" | "repeat_off" | "repeat_all" | "repeat_one">, string> = {
    play: "media_play",
    pause: "media_pause",
    play_pause: "media_play_pause",
    stop: "media_stop",
    next: "media_next_track",
    previous: "media_previous_track",
    volume_up: "volume_up",
    volume_down: "volume_down",
    mute: "volume_mute",
    unmute: "volume_mute",
    turn_on: "turn_on",
    turn_off: "turn_off",
  };

  const data: Record<string, unknown> = { entity_id: entityId };
  if (command === "mute") data.is_volume_muted = true;
  if (command === "unmute") data.is_volume_muted = false;

  return haCall("media_player", services[command], data);
}

/** Volume, seeking and source — the commands that carry a value. */
/**
 * The one command the panel does not know the meaning of.
 *
 * A speaker's own vocabulary is not in the media_player interface: "like this
 * track" is a Yandex station thing, said by sending it the phrase, and every
 * other assistant has its own. So the operator configures the service and the
 * phrase in the widget, and this sends it.
 *
 * It stays a narrow hole, not a general "call anything" endpoint: the service
 * must be a plain `domain.service` pair, and the entity is always the player the
 * widget is showing — a payload cannot reach anything else in the house.
 */
export async function haMediaSay(
  entityId: string,
  service: string,
  phrase: string
): Promise<{ ok: boolean; error?: string }> {
  if (!entityId.startsWith("media_player.")) return { ok: false, error: "not a media player" };
  if (!/^[a-z_]+\.[a-z_]+$/.test(service)) return { ok: false, error: "not a service name" };
  if (!phrase.trim()) return { ok: false, error: "no command to send" };

  const [domain, name] = service.split(".");
  // play_media is the documented way to hand a Yandex station a phrase; other
  // integrations take it as `command`. Both are sent, and the one the service
  // does not know about is ignored by Home Assistant rather than refused.
  const data =
    name === "play_media"
      ? { entity_id: entityId, media_content_id: phrase, media_content_type: "command" }
      : { entity_id: entityId, command: phrase };

  return haCall(domain, name, data);
}

export async function haMediaSet(
  entityId: string,
  what: "volume" | "seek" | "source",
  value: number | string
): Promise<{ ok: boolean; error?: string }> {
  if (!entityId.startsWith("media_player.")) return { ok: false, error: "not a media player" };

  if (what === "volume") {
    return haCall("media_player", "volume_set", {
      entity_id: entityId,
      volume_level: Math.max(0, Math.min(1, Number(value))),
    });
  }
  if (what === "seek") {
    return haCall("media_player", "media_seek", { entity_id: entityId, seek_position: Math.max(0, Number(value)) });
  }
  return haCall("media_player", "select_source", { entity_id: entityId, source: String(value) });
}

/** The one place that calls a Home Assistant service. */
async function haCall(
  domain: string,
  service: string,
  data: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await haConfig();
  if (!cfg) return { ok: false, error: "home assistant is not configured" };

  try {
    const res = await fetch(`${cfg.url}/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(data),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Turn several entities on or off at once — the whole group, in one tap.
 *
 * Uses Home Assistant's cross-domain `homeassistant.turn_on` / `turn_off`, so a
 * group holding lights and switches together is handled in a single call. Only
 * the switchable domains are touched; a sensor swept up in a group is ignored
 * rather than erroring.
 */
export async function haSetState(entityIds: string[], on: boolean): Promise<{ ok: boolean; error?: string }> {
  const cfg = await haConfig();
  if (!cfg) return { ok: false, error: "home assistant is not configured" };

  const targets = entityIds.filter((id) => {
    const domain = id.split(".")[0];
    // Scenes and scripts have no "off"; leave them out of a bulk on/off.
    return TOGGLEABLE.has(domain) && domain !== "scene" && domain !== "script";
  });
  if (targets.length === 0) return { ok: true };

  try {
    const res = await fetch(`${cfg.url}/api/services/homeassistant/${on ? "turn_on" : "turn_off"}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify({ entity_id: targets }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Detailed light control — brightness and colour temperature, not only on/off.
 *
 * `light.turn_on` takes brightness as a percentage and colour temperature in
 * kelvin; turning a light fully down is a turn_off, which is what a wall dimmer
 * does at the bottom of its travel. Only the `light` domain is accepted here.
 */
export async function haLight(
  entityId: string,
  opts: { on?: boolean; brightnessPct?: number; colorTempK?: number; rgb?: [number, number, number] }
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await haConfig();
  if (!cfg) return { ok: false, error: "home assistant is not configured" };
  if (entityId.split(".")[0] !== "light") return { ok: false, error: "not a light" };

  const off = opts.on === false || opts.brightnessPct === 0;
  const service = off ? "turn_off" : "turn_on";
  const data: Record<string, unknown> = { entity_id: entityId };
  if (!off) {
    if (opts.brightnessPct !== undefined) data.brightness_pct = Math.max(1, Math.min(100, Math.round(opts.brightnessPct)));
    // Colour and colour temperature are mutually exclusive in Home Assistant —
    // sending a colour switches the light out of temperature mode and back.
    if (opts.rgb) data.rgb_color = opts.rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))));
    else if (opts.colorTempK !== undefined) data.color_temp_kelvin = Math.round(opts.colorTempK);
  }

  try {
    const res = await fetch(`${cfg.url}/api/services/light/${service}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(data),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Flip a switch.
 *
 * Only the domains above, and only turn_on / turn_off / toggle — a dashboard
 * should not be a general remote control for the whole service.
 */
export async function haToggle(entityId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await haConfig();
  if (!cfg) return { ok: false, error: "home assistant is not configured" };

  const domain = entityId.split(".")[0];
  if (!TOGGLEABLE.has(domain)) return { ok: false, error: `${domain} cannot be switched from here` };

  // Scenes and scripts have no "off" — they are run, not toggled.
  const service = domain === "scene" || domain === "script" ? "turn_on" : "toggle";

  try {
    const res = await fetch(`${cfg.url}/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify({ entity_id: entityId }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** What the settings page shows: configured or not, secrets masked. */
export async function servicesForDisplay() {
  const [jellyfin, overseerr, qbit, arr, pbs, ha] = await Promise.all([
    getSetting<JellyfinSettings | null>(KEY.jellyfin, null),
    getSetting<OverseerrSettings | null>(KEY.overseerr, null),
    getSetting<QbitSettings | null>(KEY.qbittorrent, null),
    getSetting<ArrInstance[]>(KEY.arr, []),
    getSetting<PbsSettings | null>(KEY.pbs, null),
    getSetting<HaSettings | null>(KEY.homeassistant, null),
  ]);

  return {
    jellyfin: {
      url: jellyfin?.url ?? "",
      localUrl: jellyfin?.localUrl ?? "",
      appUrl: jellyfin?.appUrl ?? "",
      cacheLocally: !!jellyfin?.cacheLocally,
      hasKey: !!jellyfin?.apiKey,
    },
    overseerr: { url: overseerr?.url ?? "", hasKey: !!overseerr?.apiKey },
    qbittorrent: { url: qbit?.url ?? "", username: qbit?.username ?? "", hasPassword: !!qbit?.password },
    arr: arr.map((a) => ({ kind: a.kind, label: a.label, url: a.url, hasKey: !!a.apiKey })),
    pbs: { url: pbs?.url ?? "", tokenId: pbs?.tokenId ?? "", hasSecret: !!pbs?.tokenSecret, verifyTls: !!pbs?.verifyTls },
    homeassistant: { url: ha?.url ?? "", hasToken: !!ha?.token },
  };
}
