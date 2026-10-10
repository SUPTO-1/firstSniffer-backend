import type { Request, Response } from 'express';
import { Brand } from '../brand/brand.model';
import { sendResponse, sendError } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { toPublicBrand } from '../brand/brand.service';

/**
 * GET /api/public/brands
 *
 * Public-facing brand list. By default returns only `isFeatured` brands
 * (the storefront marquee). Pass `?all=true` to include every active brand.
 */
export const listPublicBrands = asyncHandler(
  async (req: Request, res: Response) => {
    const includeAll = String(req.query.all ?? '') === 'true';
    const filter: Record<string, unknown> = { isActive: true };
    if (!includeAll) filter.isFeatured = true;

    const rows = await Brand.find(filter).sort({ name: 1, _id: 1 }).lean().exec();
    const results = rows.map((r) => toPublicBrand(r as never));
    return sendResponse(res, { message: 'Brands fetched', data: results });
  }
);

/**
 * GET /api/public/brands/:idOrSlug
 *
 * Single brand. Accepts ObjectId OR slug. 404 for inactive brands.
 */
export const getPublicBrand = asyncHandler(async (req: Request, res: Response) => {
  const key = String(req.params.idOrSlug ?? '').trim();
  if (key.length === 0) {
    return sendError(res, 400, 'Brand id or slug is required');
  }

  const isId = /^[a-f\d]{24}$/i.test(key);
  const filter: Record<string, unknown> = { isActive: true };
  if (isId) filter._id = key;
  else filter.slug = key;

  const doc = await Brand.findOne(filter).exec();
  if (!doc) {
    return sendError(res, 404, 'Brand not found');
  }
  return sendResponse(res, { message: 'Brand fetched', data: toPublicBrand(doc) });
});