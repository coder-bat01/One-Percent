type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const globalBuckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  retryAfter: number;
};

export type RateLimitOptions = {
  /**
   * Global limits are kept in a separate map so a flood of user-controlled
   * client/account keys cannot clear the app-wide caps.
   */
  global?: boolean;
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
  options: RateLimitOptions = {},
): RateLimitResult {
  const time = Date.now();
  const map = options.global ? globalBuckets : buckets;
  if (map === buckets && map.size >= MAX_BUCKETS) {
    for (const [bucketKey, bucket] of map) {
      if (bucket.resetAt <= time) map.delete(bucketKey);
    }
    // Bound memory without touching the protected global buckets. An attacker
    // can rotate user-controlled keys, but the global caps remain in force.
    while (map.size >= MAX_BUCKETS) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
  const current = map.get(key);
  if (!current || current.resetAt <= time) {
    map.set(key, { count: 1, resetAt: time + windowMs });
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
