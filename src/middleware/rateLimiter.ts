import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';

/**
 * Tiny in-process IP rate limiter. Adequate for protecting a single
 * expensive endpoint (e.g. ImageKit auth) from a runaway admin session.
 *
 * For multi-instance deploys, swap this for Redis-backed counting.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

interface Options {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per IP within the window. */
  max: number;
}

export function rateLimiter(opts: Options) {
  const { windowMs, max } = opts;
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const bucket = buckets.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= max) {
      // Tell the client WHEN to come back, so a well-behaved client can
      // wait instead of hammering. `Retry-After` is in seconds, rounded
      // up so it never under-says.
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return next(
        ApiError.tooManyRequests(
          'Too many requests, please slow down and try again shortly.'
        )
      );
    }
    bucket.count += 1;
    return next();
  };
}

/**
 * Clear every rate-limit bucket.
 *
 * TEST-ONLY. The buckets live in module scope and are shared across the
 * whole process, so a test suite that exercises a limited endpoint more
 * than `max` times in a window would start failing on the limiter rather
 * than on the behaviour it is actually asserting. The suite calls this
 * in `beforeEach` to get a clean slate.
 *
 * This is NOT a production concern: the limiter is intentionally
 * process-wide, and clearing it is only safe because the only caller is
 * the test harness.
 */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}
