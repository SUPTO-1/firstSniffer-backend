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
  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(httpStatus.INTERNAL_SERVER_ERROR, message);
  }
}
