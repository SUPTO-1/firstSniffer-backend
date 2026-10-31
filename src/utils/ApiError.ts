import httpStatus from 'http-status';

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errors: unknown[];
  public readonly success: boolean;

  constructor(
    statusCode: number,
    message: string,
    errors: unknown[] = [],
    stack = ''
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.success = false;
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  static badRequest(message = 'Bad request', errors: unknown[] = []): ApiError {
    return new ApiError(httpStatus.BAD_REQUEST, message, errors);
  }
  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(httpStatus.UNAUTHORIZED, message);
  }
  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(httpStatus.FORBIDDEN, message);
  }
  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(httpStatus.NOT_FOUND, message);
  }
  static conflict(message = 'Conflict'): ApiError {
    return new ApiError(httpStatus.CONFLICT, message);
  }
  /**
   * 429 — the caller exceeded a rate limit.
   *
   * Deliberately distinct from `badRequest`: a 400 tells the client its
   * INPUT is wrong, whereas a 429 tells it to RETRY LATER. The storefront
   * shows a different message for each, and intermediaries (proxies,
   * SDK retry policies) only understand 429.
   */
  static tooManyRequests(message = 'Too many requests'): ApiError {
    return new ApiError(httpStatus.TOO_MANY_REQUESTS, message);
  }
  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(httpStatus.INTERNAL_SERVER_ERROR, message);
  }
}
