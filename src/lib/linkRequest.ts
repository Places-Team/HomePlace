import "server-only";
import { settings } from "./config";
import { clientAddress } from "./security";
export { checkDeviceActionRateLimit } from "./linkRateLimit";

const MAX_BODY_BYTES = 32 * 1024;
const PAIRING_WINDOW_MS = 60_000;
const MAX_PAIRINGS_PER_WINDOW = 20;

type PairingBucket = { count: number; resetAt: number };
const pairingBuckets = new Map<string, PairingBucket>();

export function checkPairingRateLimit(request: Request): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const key = clientAddress(request.headers, settings.trustProxyHeaders());
  for (const [source, candidate] of pairingBuckets) {
    if (candidate.resetAt <= now) pairingBuckets.delete(source);
  }
  const bucket = pairingBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (pairingBuckets.size >= 500) return { allowed: false, retryAfterSeconds: 60 };
    pairingBuckets.set(key, { count: 1, resetAt: now + PAIRING_WINDOW_MS });
    return { allowed: true };
  }
  if (bucket.count >= MAX_PAIRINGS_PER_WINDOW) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;

  return { allowed: true };
}


export async function boundedJson(request: Request): Promise<unknown | null> {
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(announced) && announced > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (!text || Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
