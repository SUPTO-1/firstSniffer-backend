import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError';

type Source = 'body' | 'query' | 'params';

/**
 * Build an Express middleware that validates a slice of the request against
 * a Zod schema. On success the parsed value replaces the original request
 * data (so downstream handlers receive a typed object). On failure throws a
 * 400 ApiError carrying structured field-level errors.
 *
 * Accepts any `ZodTypeAny`, not just plain objects, so schemas wrapped in
 * `.refine()` / `.superRefine()` / `.transform()` (which resolve to
 * `ZodEffects`) can be used directly instead of being unwrapped by hand.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed: unknown = await schema.parseAsync(req[source]);
      // Replace the source with the parsed/coerced result so handlers
      // can rely on defaults being applied (e.g. role='customer').
      // We use Object.assign to keep prototype + add properties.
      if (source === 'body') {
        req.body = parsed;
      } else if (source === 'query') {
        // express types req.query as ParsedQs — assign safely
        Object.assign(req.query, parsed);
      } else {
        // params
        Object.assign(req.params, parsed);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const fields = err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        return next(ApiError.badRequest('Validation failed', fields));
      }
      next(err);
    }
  };
}