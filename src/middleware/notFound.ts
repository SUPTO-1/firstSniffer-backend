import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import { ApiError } from '../utils/ApiError';

/**
 * Catch-all 404 handler. Mount AFTER all routes.
 */
export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}