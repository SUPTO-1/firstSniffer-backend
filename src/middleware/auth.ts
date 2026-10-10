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