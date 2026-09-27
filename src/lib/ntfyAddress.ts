import { httpBaseUrl } from "./outbound";

export function ntfyAddressError(url: string, topic: string): string | null {
  if (!httpBaseUrl(url)) return "Enter the ntfy server URL with http:// or https:// (without a topic or credentials).";
  if (!topic.trim() || topic.length > 64 || /[\s/?#\\\u0000-\u001f\u007f]/.test(topic)) {
    return "Enter one ntfy topic name, without slashes, spaces, or query parameters.";
  }
  return null;
}

export function ntfyEndpoint(url: string, topic: string): string | null {
  if (ntfyAddressError(url, topic)) return null;
  return `${httpBaseUrl(url)}/${encodeURIComponent(topic.trim())}`;
}

export function ntfyResponseError(status: number): string {
  if (status === 401 || status === 403) return "ntfy rejected the request. Check the access token and topic permissions.";
  if (status === 404) return "ntfy returned 404. Check the server base URL and reverse-proxy path.";
  if (status === 429) return "ntfy is rate-limiting requests. Try again later.";
  return `ntfy returned HTTP ${status}.`;
}
