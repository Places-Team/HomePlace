/**
 * Guessing an icon so nobody has to paste a URL.
 *
 * Three sources, in order of how much they actually know:
 *   1. the container's own homeplace.icon label — an explicit answer;
 *   2. a name match against services people actually self-host;
 *   3. the site's favicon, which every web service already publishes.
 *
 * The result is only ever a default. It fills the field in the add dialog,
 * where it can be replaced by anything, rather than being applied invisibly.
 *
 * Runs on the client as well as the server, so no server-only import here.
 */

/**
 * Known services, matched as substrings against the container image, the
 * container name and the host part of the URL.
 *
 * Ordered longest-first at match time, so "qbittorrent" is not shadowed by
 * "torrent" and "jellyseerr" is not swallowed by "jellyfin".
 */
export const SERVICE_ICONS: Record<string, string> = {
  jellyfin: "🎬",
  jellyseerr: "🎟️",
  plex: "🎞️",
  emby: "🎥",
  sonarr: "📺",
  radarr: "🍿",
  lidarr: "🎵",
  readarr: "📚",
  bazarr: "💬",
  prowlarr: "🔎",
  overseerr: "🎟️",
  qbittorrent: "🌀",
  transmission: "🔄",
  deluge: "💧",
  sabnzbd: "📦",
  nzbget: "📦",
  nextcloud: "☁️",
  owncloud: "☁️",
  syncthing: "🔁",
  immich: "🖼️",
  photoprism: "🖼️",
  paperless: "📄",
  calibre: "📖",
  audiobookshelf: "🎧",
  navidrome: "🎶",
  grafana: "📈",
  prometheus: "🔥",
  influxdb: "📊",
  loki: "🪵",
  uptime: "⏱️",
  portainer: "🐳",
  docker: "🐳",
  traefik: "🚦",
  nginx: "🌐",
  caddy: "🧱",
  proxy: "🔀",
  pihole: "🛡️",
  adguard: "🛡️",
  wireguard: "🔐",
  vaultwarden: "🔑",
  bitwarden: "🔑",
  authelia: "🪪",
  authentik: "🪪",
  keycloak: "🪪",
  homeassistant: "🏠",
  "home-assistant": "🏠",
  hass: "🏠",
  nodered: "🔴",
  "node-red": "🔴",
  zigbee: "📡",
  mqtt: "📨",
  mosquitto: "📨",
  esphome: "🔌",
  frigate: "📹",
  zoneminder: "📹",
  minecraft: "⛏️",
  pterodactyl: "🎮",
  steam: "🎮",
  gitea: "🌿",
  gitlab: "🦊",
  github: "🐙",
  jenkins: "🔨",
  drone: "🚁",
  postgres: "🐘",
  mysql: "🐬",
  mariadb: "🐬",
  mongo: "🍃",
  redis: "🧠",
  sqlite: "🗃️",
  elastic: "🔍",
  rabbitmq: "🐇",
  minio: "🪣",
  vault: "🔒",
  backup: "💾",
  duplicati: "💾",
  restic: "💾",
  pbs: "💾",
  proxmox: "🖥️",
  truenas: "🗄️",
  unraid: "🗄️",
  samba: "📁",
  nfs: "📁",
  ftp: "📁",
  mail: "✉️",
  roundcube: "✉️",
  telegram: "✈️",
  matrix: "💠",
  synapse: "💠",
  discord: "💬",
  wiki: "📗",
  bookstack: "📗",
  outline: "📗",
  ghost: "👻",
  wordpress: "📝",
  vikunja: "✅",
  focalboard: "✅",
  planka: "✅",
  firefly: "💰",
  actual: "💰",
  speedtest: "🚀",
  dashboard: "🧭",
  homepage: "🧭",
  homeplace: "🏡",
  music: "🎵",
  camera: "📷",
  printer: "🖨️",
  octoprint: "🖨️",
  vpn: "🔐",
  xray: "🛰️",
  router: "📶",
  api: "🔌",
};

/**
 * A general-purpose set for tiles that are not a known service: bookmarks,
 * folders, notes. Grouped roughly by what someone is looking for, because a
 * flat wall of two hundred emoji is a worse picker than a short list.
 */
export const GENERAL_ICONS: string[] = [
  "🏠", "🏡", "🖥️", "💻", "📱", "🗂️", "📁", "📂", "🔗", "⭐", "❤️", "🔥",
  "🎬", "🎵", "🎧", "🎮", "📺", "📷", "🖼️", "📚", "📖", "📝", "🗒️", "📌",
  "🛒", "💰", "💳", "📊", "📈", "🗓️", "⏰", "⏱️", "🔔", "✅", "🧩", "⚙️",
  "🔧", "🛠️", "🔌", "🔑", "🔒", "🛡️", "🌐", "📡", "📶", "☁️", "💾", "💽",
  "🗄️", "🖨️", "🌡️", "💡", "🔋", "🚗", "✈️", "🌤️", "🌙", "🐳", "🐧", "🚀",
];

/**
 * Dashboard Icons is pinned to a reviewed revision. This keeps icon rendering
 * reproducible and prevents a moving CDN branch from changing an installation
 * without a HomePlace update.
 */
export const DASHBOARD_ICONS_REF = "ce550a844bad92ea19b5926cb887285c46bac01a";
export const DASHBOARD_ICONS_REPOSITORY = "https://github.com/homarr-labs/dashboard-icons";

/** A safe CDN URL for one Dashboard Icons slug. */
export function dashboardIconUrl(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) return "";
  return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@${DASHBOARD_ICONS_REF}/png/${normalized}.png`;
}

/**
 * Turn the upstream tree.json payload into a stable, deduplicated list.
 * Parsing stays strict because this data crosses a public network boundary.
 */
export function dashboardIconSlugs(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const png = (payload as { png?: unknown }).png;
  if (!Array.isArray(png)) return [];

  return [...new Set(
    png
      .filter((entry): entry is string => typeof entry === "string")
      .filter((entry) => /^[a-z0-9][a-z0-9-]*\.png$/.test(entry))
      .map((entry) => entry.slice(0, -4)),
  )].sort((a, b) => a.localeCompare(b));
}

/**
 * Which known service this looks like, or "".
 *
 * Longest key first: several keys can match one string, and the most specific
 * one is almost always the right answer — "jellyseerr" must not resolve to
 * "jellyfin", "qbittorrent" not to "torrent".
 */
export function guessKey(input: { name?: string; image?: string; url?: string }): string {
  const haystack = [input.name, input.image, hostOf(input.url)].filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return "";
  return (
    Object.keys(SERVICE_ICONS)
      .sort((a, b) => b.length - a.length)
      .find((key) => haystack.includes(key)) ?? ""
  );
}

/** Best guess for a tile icon, as an emoji. Works with no internet at all. */
export function guessIcon(input: { name?: string; image?: string; url?: string }): string {
  const key = guessKey(input);
  return key ? SERVICE_ICONS[key] : "";
}

/**
 * Real logo for a known service, from the community icon pack.
 *
 * Off by default and switched on in settings, because it is the one thing in
 * HomePlace that fetches from the public internet. A panel on a LAN with no
 * route out would otherwise show a row of broken images — the emoji above
 * always works, so the pack is an upgrade rather than a dependency.
 */
export function iconPackUrl(input: { name?: string; image?: string; url?: string }): string {
  const key = guessKey(input);
  return serviceLogo(key);
}

/**
 * Where the community icon pack's slug differs from the key HomePlace uses for a
 * service. Everything not listed uses its key verbatim, which is right far more
 * often than not.
 */
const LOGO_SLUG: Record<string, string> = {
  homeassistant: "home-assistant",
  hass: "home-assistant",
  pbs: "proxmox-backup-server",
  proxmox: "proxmox",
  qbittorrent: "qbittorrent",
};

/**
 * The real logo for a known service, by key — the actual product mark rather
 * than the stand-in emoji. Used by the service widgets so their header reads as
 * "Jellyfin", not "🎬". Always paired with the emoji as a fallback: on a LAN
 * with no route out the image will not load, and `TileIcon` swaps to the emoji
 * on its own.
 */
export function serviceLogo(key: string | undefined): string {
  if (!key) return "";
  const slug = LOGO_SLUG[key] ?? key;
  return dashboardIconUrl(slug);
}

/**
 * The site's own favicon.
 *
 * Loaded straight from the service by the browser, not proxied through the
 * panel: the browser is already on the same network, and proxying would turn
 * HomePlace into a fetcher of arbitrary URLs on behalf of whoever can add a
 * tile. When it 404s, the tile falls back to the first letter (see TileIcon).
 */
export function faviconUrl(url: string | null | undefined): string {
  const host = originOf(url);
  return host ? `${host}/favicon.ico` : "";
}

/**
 * The icon a tile should show when it has none of its own.
 *
 * Order: the icon pack when it is enabled, then the service's own favicon,
 * then the emoji. Images can fail — the host is down, there is no favicon, the
 * pack has no logo — so `TileIcon` is given the emoji as a fallback and swaps
 * to it silently when an image does not load.
 */
export function autoIcon(input: { name?: string; image?: string; url?: string; pack?: boolean }): string {
  if (input.pack) {
    const packed = iconPackUrl(input);
    if (packed) return packed;
  }
  return faviconUrl(input.url) || guessIcon(input);
}

function hostOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

function originOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

/**
 * Glyphs for things that are not services.
 *
 * Kept next to the service icons so every symbol in the interface has one
 * source, rather than emoji scattered through the components.
 */
export const GLYPH = {
  folder: "📁",
  link: "🔗",
  widget: "🧩",
  container: "🐳",
  dashboard: "🧭",
  monitoring: "📈",
  events: "🔔",
  settings: "⚙️",
  search: "🔍",
  host: "🖥️",
  disk: "💽",
  cpu: "⚡",
  memory: "🧠",
  network: "📶",
  temperature: "🌡️",
  up: "🟢",
  down: "🔴",
  logs: "🪵",
  restart: "🔁",
  start: "▶️",
  stop: "⏹️",
  open: "↗",
  details: "›",
} as const;
