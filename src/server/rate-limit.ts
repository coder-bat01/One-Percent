type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  retryAfter: number;
};

/**
 * A small fixed-window limiter for a single-process deployment.
 *
 * The app runs as one persistent Node process (SQLite and the in-memory SSE
 * bus already require that), so a process-local limiter is consistent with
 * the rest of the architecture. If this app is ever run as multiple replicas,
 * move this state to a shared store.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const time = Date.now();
  if (buckets.size >= MAX_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= time) buckets.delete(bucketKey);
    }
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
  }
  const current = buckets.get(key);
  if (!current || current.resetAt <= time) {
    buckets.set(key, { count: 1, resetAt: time + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= limit)
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - time) / 1000)),
    };
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export function clientKey(request: { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const address =
    request.headers.get("x-real-ip")?.trim() ||
    forwarded?.split(",")[0]?.trim() ||
    "unknown";
  return address.slice(0, 64);
}
