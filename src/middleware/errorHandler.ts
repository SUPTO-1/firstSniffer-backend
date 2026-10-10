import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import httpStatus from 'http-status';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';
import { sendError } from '../utils/sendResponse';
import { isProd } from '../config/env';

/**
 * Centralised error handler — converts thrown errors into the standard
 * response envelope. Must be the last middleware registered.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Our own ApiError
  if (err instanceof ApiError) {
    sendError(res, err.statusCode, err.message, err.errors);
    return;
  }

  // 2. Zod (e.g. if a controller ever throws directly)
  if (err instanceof ZodError) {
    sendError(res, httpStatus.BAD_REQUEST, 'Validation failed', err.issues);
    return;
  }

  // 3. Mongoose validation
  if (err instanceof mongoose.Error.ValidationError) {
    const fields = Object.values(err.errors).map((e) => ({
      path: e.path,
      message: e.message,
    }));
    sendError(res, httpStatus.BAD_REQUEST, 'Validation failed', fields);
    return;
  }

  // 4. Mongoose duplicate key
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: number }).code === 11000
  ) {
    sendError(
      res,
      httpStatus.CONFLICT,
      'A record with these values already exists'
    );
    return;
  }

  // 5. Unknown — never leak internals in production
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  const message =
    err instanceof Error ? err.message : 'Internal server error';
  sendError(
    res,
    httpStatus.INTERNAL_SERVER_ERROR,
    isProd ? 'Internal server error' : message
  );
}