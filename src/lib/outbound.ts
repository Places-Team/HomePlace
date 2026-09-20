const DEFAULT_JSON_LIMIT = 4 * 1024 * 1024;

/**
 * Normalise an administrator supplied service address without making local
 * networks second-class. Private IPs and hostnames are valid HomePlace targets;
 * credentials, fragments and non-HTTP protocols are not.
 */
export function httpBaseUrl(value: string): string | null {
  const input = value.trim();
  if (!input || input.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(input)) return null;

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) return null;

    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function httpBaseUrlError(value: string): string | null {
  return value.trim() && !httpBaseUrl(value)
    ? "use a valid http:// or https:// address without credentials, spaces, query parameters or fragments"
    : null;
}

/** Read JSON without allowing a compromised service to fill server memory. */
export async function limitedBytes(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("response too large");

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function limitedJson<T>(response: Response, maxBytes = DEFAULT_JSON_LIMIT): Promise<T> {
  const bytes = await limitedBytes(response, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
