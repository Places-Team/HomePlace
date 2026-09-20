type Bucket = { count: number; resetAt: number };
const actionBuckets = new Map<string, Bucket>();

export function checkDeviceActionRateLimit(
  deviceId: string,
  action: string,
  maximum = 20,
): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const key = `${deviceId}:${action}`;
  for (const [source, candidate] of actionBuckets) {
    if (candidate.resetAt <= now) actionBuckets.delete(source);
  }
  const bucket = actionBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (actionBuckets.size >= 2_000) return { allowed: false, retryAfterSeconds: 60 };
    actionBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return { allowed: true };
  }
  if (bucket.count >= maximum) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { allowed: true };
}
