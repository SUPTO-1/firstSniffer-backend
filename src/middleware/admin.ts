import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';

/**
 * Must be used after `authRequired`. Rejects if the authenticated user
 * does not have the `admin` role.
 */
export function adminOnly(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }
  if (req.user.role !== 'admin') {
    return next(ApiError.forbidden('Admin privileges required'));
  }
  return next();
}