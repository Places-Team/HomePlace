/**
 * Everything host-specific arrives through the environment.
 *
 * This repository is public, so no address, token or password may be committed.
 * A checkout with an empty .env must still start: every integration below is
 * optional and simply reports itself as "not configured" when its variables are
 * missing. The UI reads these flags and hides what cannot work instead of
 * showing broken panels.
 */

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function bool(name: string, fallback = false): boolean {
  const v = env(name)?.toLowerCase();
  if (v === undefined) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function int(name: string, fallback: number): number {
  const v = Number(env(name));
  return Number.isFinite(v) ? v : fallback;
}

export type DockerHost = {
  /** Stable identifier stored on tiles — renaming the label must not break them. */
  key: string;
  label: string;
  /** Base URL of the Docker HTTP API, normally a socket proxy. */
  url: string;
};

/**
 * Docker endpoints.
 *
 * Two ways to configure, in order of precedence:
 *   DOCKER_HOSTS  — JSON array, for several machines:
 *                   [{"key":"main","label":"Server","url":"http://docker-proxy:2375"}]
 *   DOCKER_API_URL — a single endpoint, the common case.
 *
 * Note it is an HTTP URL, not /var/run/docker.sock. Mounting the raw socket into
 * a web application hands it root on the host; a socket proxy in front of it can
 * be limited to the calls this panel actually makes.
 */
export function dockerHosts(): DockerHost[] {
  const raw = env("DOCKER_HOSTS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((h) => h && typeof h.url === "string")
          .map((h, i) => ({
            key: String(h.key ?? `docker${i + 1}`),
            label: String(h.label ?? h.key ?? `Docker ${i + 1}`),
            url: String(h.url).replace(/\/+$/, ""),
          }));
      }
    } catch {
      // A malformed value must not take the whole panel down: fall through to
      // the single-endpoint variable and let the health page report it.
      console.error("DOCKER_HOSTS is not valid JSON — ignoring it");
    }
  }
  const single = env("DOCKER_API_URL");
  if (single) {
    return [{ key: "main", label: env("DOCKER_HOST_LABEL") ?? "Docker", url: single.replace(/\/+$/, "") }];
  }
  return [];
}

export function prometheus() {
  const url = env("PROMETHEUS_URL");
  if (!url) return null;
  return {
    url: url.replace(/\/+$/, ""),
    // Optional basic auth, for a Prometheus published behind a proxy.
    username: env("PROMETHEUS_USERNAME"),
    password: env("PROMETHEUS_PASSWORD"),
  };
}

export function proxmox() {
  const url = env("PROXMOX_URL");
  const tokenId = env("PROXMOX_TOKEN_ID");
  const tokenSecret = env("PROXMOX_TOKEN_SECRET");
  if (!url || !tokenId || !tokenSecret) return null;
  return {
    url: url.replace(/\/+$/, ""),
    tokenId,
    tokenSecret,
    /** Home labs run Proxmox with a self-signed certificate; allow opting out. */
    verifyTls: bool("PROXMOX_VERIFY_TLS", false),
  };
}

/** Public base URL, needed to build the OAuth redirect_uri. */
export function appUrl(): string {
  return (env("APP_URL") ?? "http://localhost:3200").replace(/\/+$/, "");
}

export const settings = {
  /** May the panel start/stop/restart containers, or is it read-only? */
  allowContainerControl: () => bool("ALLOW_CONTAINER_CONTROL", true),
  /** How long the rolling uptime window is kept. */
  uptimeRetentionDays: () => int("UPTIME_RETENTION_DAYS", 30),
  /** Floor for per-tile check intervals, to keep a typo from hammering a service. */
  minCheckInterval: () => int("MIN_CHECK_INTERVAL", 15),
  /** Background prober; turn off if you only want the dashboard. */
  monitorEnabled: () => bool("MONITOR_ENABLED", true),
  defaultLocale: () => (env("DEFAULT_LOCALE") === "ru" ? "ru" : "en"),
  /** Cookies over plain HTTP need the Secure flag off — LAN installs are http. */
  secureCookies: () => bool("SECURE_COOKIES", appUrl().startsWith("https://")),
  sessionDays: () => int("SESSION_DAYS", 30),
  /** Trust forwarding headers only behind a proxy that overwrites them. */
  trustProxyHeaders: () => bool("TRUST_PROXY_HEADERS", false),
};

// "What can this installation do right now?" lives in integrations.ts, because
// the answer now depends on the database as well as on .env — and this module
// must not import that one, or the two would import each other.
