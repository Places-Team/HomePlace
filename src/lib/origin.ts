import "server-only";
import { headers } from "next/headers";
import { appUrl, settings } from "./config";
import { safeRequestOrigin } from "./security";

/**
 * The address this panel is actually being used at.
 *
 * `APP_URL` is what background jobs have to use — an alert is composed with
 * nobody's browser attached — but it is also the setting most likely to be left
 * at its default, and a wrong one is invisible until an OAuth round-trip sends
 * somebody to `localhost:3200` from their laptop.
 *
 * Request headers are accepted only when they match APP_URL, or while the
 * untouched localhost default is used with a private LAN address. Forwarding
 * headers require an explicit trusted-proxy setting.
 */
export async function requestOrigin(): Promise<string | null> {
  try {
    return safeRequestOrigin(await headers(), appUrl(), settings.trustProxyHeaders());
  } catch {
    // Called outside a request (a background job): there is no origin to read.
    return null;
  }
}

/**
 * Origin to build user-facing links with: the current request when there is
 * one, the configured APP_URL otherwise.
 */
export async function effectiveOrigin(): Promise<string> {
  return (await requestOrigin()) ?? appUrl();
}
