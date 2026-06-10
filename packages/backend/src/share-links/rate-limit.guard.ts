import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const RATE_LIMIT_KEY = 'kalepin:rate-limit';

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  /** Stable name; used as part of the bucket key so different routes don't
   * share counters even when they share an IP. */
  name: string;
}

/**
 * Decorate a route handler with `@RateLimit({ max, windowMs, name })` to enable
 * per-IP throttling by `AnonymousRateLimitGuard`.
 */
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);

interface BucketEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory sliding-window limiter for anonymous endpoints. The counters live
 * for the duration of the process — fine for a single-node deploy and for
 * abuse mitigation (not regulatory rate quotas). A multi-node deploy would
 * swap this for Redis / Upstash without changing the guard surface.
 *
 * Cleanup is lazy: each `consume` call expires its own bucket if past
 * `resetAt`. To bound memory, when the map grows past `MAX_BUCKETS` we drop
 * the oldest expired entry — abusers do not get long-term tracking, and that
 * is fine because legitimate clients re-create their entry on first request.
 */
@Injectable()
export class AnonymousRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly MAX_BUCKETS = 10_000;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const opts = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!opts) return true; // no decorator: pass through

    const req = context.switchToHttp().getRequest();
    // Authenticated requests bypass anonymous rate limiting. Their identity
    // ties them to a real account, which is itself rate-limitable elsewhere.
    if (req.user) return true;

    const ip = extractIp(req);
    const key = `${opts.name}:${ip}`;
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (this.buckets.size > this.MAX_BUCKETS) {
      // Soft eviction: drop the first expired bucket we find. O(n) worst-case
      // but only triggers when abuse pressure is real, and the iteration is
      // bounded by MAX_BUCKETS per overflow event.
      for (const [k, v] of this.buckets) {
        if (v.resetAt <= now) {
          this.buckets.delete(k);
          break;
        }
      }
    }

    if (bucket.count > opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new HttpException(
        {
          error: 'rate-limited',
          message: 'Too many requests',
          retryAfter: retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** Test helper — clears state between cases. Not used in prod. */
  _reset() {
    this.buckets.clear();
  }
}

function extractIp(req: any): string {
  // Prefer X-Forwarded-For when behind a known proxy. Fall back to req.ip.
  // The shape mirrors `access-log/extract-ip.ts` which is the canonical
  // implementation; we don't import to avoid a tight coupling and to keep
  // the guard minimal.
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}
