import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async Express handler so any thrown / rejected error is forwarded
 * to `next()` instead of becoming an unhandledRejection. Express 4 does not
 * await handlers, so this is required for any async controller.
 */
export const asyncHandler =
  <
    Req extends Request = Request,
    Res extends Response = Response,
  >(
    fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
