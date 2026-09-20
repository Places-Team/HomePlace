export const MAX_SHARE_TEXT = 8_000;
export const MAX_SHARE_URL = 4_096;
// Large enough for documents and short media without letting the current
// in-memory encryption pipeline put unbounded pressure on a self-hosted server.
export const MAX_SHARE_FILE_BYTES = 64 * 1024 * 1024;
export const SHARE_LIFETIME_MS = 5 * 60_000;

export type ShareMessage = { type: "text" | "url"; value: string; targetDeviceId: string };

export function parseShareMessage(value: unknown): ShareMessage | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const targetDeviceId = validDeviceId(input.targetDeviceId);
  if (!targetDeviceId || (input.type !== "text" && input.type !== "url") || typeof input.value !== "string") return null;
  const content = input.value.trim();
  if (!content || content.length > (input.type === "url" ? MAX_SHARE_URL : MAX_SHARE_TEXT)) return null;
  if (input.type === "url" && !safeSharedUrl(content)) return null;
  return { type: input.type, value: content, targetDeviceId };
}

export function safeSharedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validDeviceId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : null;
}

export function safeFilename(value: string): string {
  const cleaned = value.replace(/[\\/\0-\x1f\x7f]/g, "_").trim();
  return (cleaned && !/^[_ .]+$/.test(cleaned) ? cleaned : "shared-file").slice(0, 180);
}
