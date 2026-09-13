import packageJson from "../../package.json";

const LATEST_RELEASE_API = "https://api.github.com/repos/Places-Team/HomePlace/releases/latest";
const RELEASE_PATH_PREFIX = "/Places-Team/HomePlace/releases/tag/";
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

type ParsedVersion = {
  core: [number, number, number];
  prerelease: string | null;
};

export type HomePlaceUpdate = {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
};

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;

  const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (core.some((part) => !Number.isSafeInteger(part))) return null;
  return { core, prerelease: match[4] ?? null };
}

/** Compare the stable SemVer forms used by HomePlace release tags. */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

/** Turn an untrusted GitHub API response into a safe update link. */
export function releaseUpdateFrom(payload: unknown, currentVersion: string): HomePlaceUpdate | null {
  if (!payload || typeof payload !== "object") return null;
  const release = payload as Record<string, unknown>;
  if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") return null;

  const comparison = compareVersions(currentVersion, release.tag_name);
  if (comparison === null || comparison >= 0) return null;

  try {
    const url = new URL(release.html_url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(RELEASE_PATH_PREFIX)
    ) {
      return null;
    }
    return {
      currentVersion: currentVersion.replace(/^v/, ""),
      latestVersion: release.tag_name.replace(/^v/, ""),
      releaseUrl: url.toString(),
    };
  } catch {
    return null;
  }
}

/**
 * Check the fixed public release feed. Failure is intentionally silent: an
 * offline or rate-limited self-hosted installation must keep working normally.
 */
export async function availableHomePlaceUpdate(): Promise<HomePlaceUpdate | null> {
  if (/^(?:0|false|no|off)$/i.test(process.env.CHECK_FOR_UPDATES?.trim() ?? "")) return null;

  const currentVersion = process.env.HOMEPLACE_VERSION?.trim() || packageJson.version;
  if (!parseVersion(currentVersion)) return null;

  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "HomePlace",
      },
      next: { revalidate: 21_600 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return releaseUpdateFrom(await response.json(), currentVersion);
  } catch {
    return null;
  }
}
