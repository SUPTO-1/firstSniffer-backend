import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { rateLimiter } from '../../middleware/rateLimiter';
import { getAuthParams } from './imagekit.controller';

const router = Router();

/**
 * GET /api/imagekit/auth — admin-only, rate-limited (30 req/min per IP).
 * Returns the signed-auth triplet for client-side uploads.
 */
router.get(
  '/auth',
  authRequired,
  adminOnly,
  rateLimiter({ windowMs: 60_000, max: 30 }),
  getAuthParams
);

export default router;
