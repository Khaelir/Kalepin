// Single-process sliding-window rate limiter used by `/oauth/register` (per-IP)
// and `/oauth/token` (per-client). The OAuth surface is not high-QPS and the
// backend deploys as a single Node process, so an in-memory limiter is enough.
// If the backend is ever scaled horizontally this needs to move to a shared
// store (Redis, DB) — until then, simple wins.

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly options: RateLimitOptions) {}

  check(key: string, now: number = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const since = now - this.options.windowMs;
    const arr = this.hits.get(key) ?? [];
    // Drop hits older than the window.
    let i = 0;
    while (i < arr.length && arr[i] <= since) i++;
    const recent = i === 0 ? arr : arr.slice(i);

    if (recent.length >= this.options.max) {
      const oldest = recent[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.options.windowMs - now) / 1000));
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSec };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSec: 0 };
  }

  // Useful for tests and for a periodic cleanup pass.
  reset(key?: string): void {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }
}
