import type { Request, Response } from 'express';
import { Review } from '../review/review.model';
import { Product } from '../product/product.model';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * GET /api/public/reviews
 *
 * Public storefront review list. Only APPROVED + ACTIVE reviews are served —
 * pending and rejected ones stay admin-only, exactly like the moderation
 * workflow intends.
 *
 * SHAPE: a FLAT ARRAY, not a paged envelope. (The admin `/reviews` endpoint
 * is the paged one.)
 *
 * Each entry is decorated with the product it belongs to so the storefront
 * can render a review card and link back to the product page without a
 * second request per review.
 */
export const listPublicReviews = asyncHandler(
  async (req: Request, res: Response) => {
    const q = req.query as Record<string, unknown>;

    // Optional product scoping — used by the product detail page.
    const productId = String(q.product ?? '').trim();

    // A review needs a product to be shown on. Products that are inactive or
    // soft-deleted are excluded so a review never links to a dead page.
    const filter: Record<string, unknown> = {
      status: 'approved',
      isActive: true,
    };
    if (productId) filter.product = productId;

    const rows = await Review.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .lean()
      .exec();

    if (rows.length === 0) {
      return sendResponse(res, { message: 'Reviews fetched', data: [] });
    }

    /**
     * Batch-load the products these reviews point at. One query for the
     * whole page instead of one per review.
     */
    const productIds = [
      ...new Set(
        rows.map((r) => String((r as { product?: unknown }).product ?? ''))
      ),
    ].filter(Boolean);

    const products = await Product.find({
      _id: { $in: productIds },
      isActive: true,
      deletedAt: null,
    })
      .select('name slug images brand averageRating')
      .populate('brand', 'name slug logo')
      .lean()
      .exec();

    const productById = new Map(
      products.map((p) => {
        const raw = p as unknown as Record<string, unknown>;
        const brand = raw.brand as
          | { id?: string; name?: string; slug?: string }
          | null;
        return [
          String(raw._id ?? ''),
          {
            id: String(raw._id ?? ''),
            name: String(raw.name ?? ''),
            slug: String(raw.slug ?? ''),
            image: String(
              (raw.images as Array<{ url?: string }> | undefined)?.[0]?.url ?? ''
            ),
            brandName: String(brand?.name ?? ''),
            brandSlug: String(brand?.slug ?? ''),
            averageRating: Number(raw.averageRating ?? 0),
          },
        ];
      })
    );

    const data = rows
      .map((r) => {
        const raw = r as unknown as Record<string, unknown>;
        const product = productById.get(String(raw.product ?? ''));
        // A review whose product is gone is dropped rather than shown as an
        // orphan card.
        if (!product) return null;

        const images = (raw.images as Array<{ url?: string }> | undefined) ?? [];

        return {
          id: String(raw._id ?? ''),
          rating: Number(raw.rating ?? 0),
          title: String(raw.title ?? ''),
          comment: String(raw.comment ?? ''),
          images: images
            .map((i) => ({ url: String(i?.url ?? '') }))
            .filter((i) => i.url.length > 0),
          /**
           * The reviewer is a customer, not a public identity. We expose a
           * display name only — no id, no email.
           */
          author: 'Verified Customer',
          verified: true,
          date: raw.createdAt
            ? new Date(raw.createdAt as Date).toISOString()
            : '',
          product,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return sendResponse(res, { message: 'Reviews fetched', data });
  }
);
