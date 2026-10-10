import { Router } from 'express';
import { getSettings } from '../settings/settings.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

/**
 * GET /api/public/settings
 *
 * Public, unauthenticated — the storefront (header, footer, checkout,
 * homepage) needs shipping charges, store name, contact details, social
 * links without an admin login. The payload is intentionally minimal
 * (same shape as the admin PublicSettings — there are no admin-only
 * fields at the moment).
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const data = await getSettings();
    return sendResponse(res, { message: 'Settings fetched', data });
  })
);

export default router;
