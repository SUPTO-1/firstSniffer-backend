import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME } from '../config/cookie';
import { ApiError } from '../utils/ApiError';
import { verifyToken } from '../utils/jwt';

/**
 * Verifies the JWT cookie and attaches the decoded payload to req.user.
 * 401s when there is no token or the token is invalid.
 */
export function authRequired(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const token =
    req.cookies?.[AUTH_COOKIE_NAME] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined);

  if (!token) {
    return next(ApiError.unauthorized('Authentication required'));
  }

  try {
    const decoded = verifyToken(token);
    req.user = { ...decoded, id: decoded.sub };
    return next();
  } catch {
    return next(ApiError.unauthorized('Invalid or expired session'));
  }
}

/**
 * Populate `req.user` IF a valid token is present — but never require one.
 *
 * This is for routes that serve BOTH anonymous and signed-in callers
 * (storefront checkout accepts admins, signed-in customers and guests).
 * `authRequired` cannot be used there, because it would reject the
 * anonymous callers outright.
 *
 * A missing token is NOT an error — `req.user` simply stays undefined
 * and the route's own guard decides what an anonymous caller may do.
 * A token that is present but INVALID is also not an error here: the
 * request is treated as anonymous. That is deliberate. A stale cookie
 * must not lock a guest out of checkout; it should simply make them a
 * guest, and the route's guard will then require `guestInfo`.
 */
export function authOptional(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const token =
    req.cookies?.[AUTH_COOKIE_NAME] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined);

  if (!token) return next();

  try {
    const decoded = verifyToken(token);
    req.user = { ...decoded, id: decoded.sub };
  } catch {
    // An unusable token is treated as no token at all.
  }
  return next();
}