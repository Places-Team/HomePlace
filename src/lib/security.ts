import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

type HeaderReader = { get(name: string): string | null };

export function hasMinimumSecretLength(value: string): boolean {
  return Buffer.byteLength(value, "utf8") >= 32;
}

/** Compares secrets without leaking how many leading bytes matched. */
export function secretsEqual(expected: string, provided: string): boolean {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  return expected.length > 0 && provided.length > 0 && timingSafeEqual(expectedDigest, providedDigest);
}

/**
 * Returns a rate-limit key without trusting spoofable forwarding headers.
 * Deployments may opt in only when their reverse proxy overwrites these fields.
 */
export function clientAddress(headers: HeaderReader, trustProxy: boolean): string {
  if (!trustProxy) return "untrusted-proxy";
  const candidate =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "";
  return isIP(candidate) ? candidate : "unknown";
}

/** Local origins are safe fallbacks while APP_URL still has its default value. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(host) === 6) return host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return false;
}

/** Resolves a browser-facing origin without permitting Host-header redirects. */
export function safeRequestOrigin(headers: HeaderReader, configuredUrl: string, trustProxy: boolean): string | null {
  try {
    const forwardedHost = trustProxy ? headers.get("x-forwarded-host")?.split(",")[0]?.trim() : null;
    const host = forwardedHost || headers.get("host")?.trim();
    if (!host) return null;

    const hostname = new URL(`http://${host}`).hostname;
    const forwardedProto = trustProxy ? headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : null;
    const protocol = forwardedProto || (isLocalHostname(hostname) ? "http" : "https");
    if (protocol !== "http" && protocol !== "https") return null;

    const candidate = new URL(`${protocol}://${host}`).origin;
    const configured = new URL(configuredUrl).origin;
    if (candidate === configured) return candidate;

    // Keep zero-config LAN access useful, but never accept an arbitrary public
    // Host header as the target of an OAuth redirect.
    if (configured === "http://localhost:3200" && isLocalHostname(new URL(candidate).hostname)) return candidate;
    return null;
  } catch {
    return null;
  }
}
