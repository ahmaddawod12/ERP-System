/**
 * Simple in-memory rate limiter for Next.js API routes.
 * Per-instance only (sufficient for serverless with short lifetimes).
 * For distributed rate limiting, use Redis or Firestore counters.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 10_000;

// Periodic cleanup to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 60_000);

interface RateLimitOptions {
  /** Maximum requests per window (default: 5) */
  max?: number;
  /** Window duration in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number;
}

/**
 * Check if a request identified by `key` exceeds the rate limit.
 * Returns null if allowed, or an error Response if blocked.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions = {},
): Response | null {
  const { max = 5, windowMs = 60_000 } = options;
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    store.set(key, entry);
    if (store.size > MAX_STORE_SIZE) {
      // Evict expired entries when store gets too large
      for (const [k, v] of store) {
        if (now > v.resetAt) store.delete(k);
      }
    }
    return null;
  }

  entry.count += 1;
  if (entry.count > max) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "rate_limited", message: "Too many requests. Please try again later." },
      }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)) } },
    );
  }

  return null;
}
