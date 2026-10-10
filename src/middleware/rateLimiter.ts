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
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const bucket = buckets.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= max) {
      return next(
        ApiError.badRequest(
          'Too many requests, please slow down and try again shortly.'
        )
      );
    }
    bucket.count += 1;
    return next();
  };
}
