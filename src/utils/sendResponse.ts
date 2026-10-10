import type { Response } from 'express';

export interface SuccessResponse<T> {
  success: true;
  message: string;
  data: T;
}

export interface ErrorResponseBody {
  success: false;
  message: string;
  errors: unknown[];
  data?: null;
}

interface SendOptions<T> {
  statusCode?: number;
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
}

/**
 * Single source of truth for HTTP response shape.
 * Always serialises to:
 *   { success: true, message, data }
 *   { success: false, message, errors }
 */
export function sendResponse<T>(
  res: Response,
  options: SendOptions<T> = {}
): Response {
  const statusCode = options.statusCode ?? 200;
  const body: SuccessResponse<T> & { meta?: Record<string, unknown> } = {
    success: true,
    message: options.message ?? 'Success',
    data: (options.data ?? null) as T,
  };
  if (options.meta) body.meta = options.meta;
  return res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  errors: unknown[] = []
): Response {
  const body: ErrorResponseBody = {
    success: false,
    message,
    errors,
    data: null,
  };
  return res.status(statusCode).json(body);
}