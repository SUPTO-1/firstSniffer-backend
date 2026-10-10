import type { Request, Response } from 'express';
import { Product } from '../product/product.model';
import { sendResponse, sendError } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { toPublicProduct } from '../product/product.service';
import type { PublicProduct } from '../product/product.interface';

/**
 * Filter shape for the public storefront listing — only the boolean flags
 * a customer-facing page actually cares about. (We do NOT expose `isActive`
 * — that's an admin concept. Public callers always see active, non-deleted
 * rows.)
 */
const PUBLIC_PRODUCT_FLAGS = [
  'featured',
  'bestSelling',
  'topRated',
  'newArrival',
] as const;
type PublicProductFlag = (typeof PUBLIC_PRODUCT_FLAGS)[number];

interface PublicProductQuery {
  flag?: string;
  brand?: string;
  genre?: string;
  search?: string;
  limit?: number;
  page?: number;
  sort?: string;
}

const POPULATE = [
  'brand',
  'genres',
  'notes.top',
  'notes.middle',
  'notes.base',
  'seasons',
  'occasions',
  'weathers',
  'times',
];

function pickPublicFlag(raw: unknown): PublicProductFlag | null {
  if (typeof raw !== 'string') return null;
  return (PUBLIC_PRODUCT_FLAGS as readonly string[]).includes(raw)
    ? (raw as PublicProductFlag)
    : null;
}

function parsePositiveInt(raw: unknown, fallback: number, max = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

/**
 * GET /api/public/products
 *
 * Public-facing storefront listing. Always filters `isActive: true` and
 * `deletedAt: null`. Optional flag filter narrows to one merchandising
 * collection (e.g. `?flag=bestSelling` for the homepage's Best Sellers
 * section). Pagination is supported but capped at 100 rows.
 */
export const listPublicProducts = asyncHandler(
  async (req: Request, res: Response) => {
    const q = req.query as PublicProductQuery;

    const filter: Record<string, unknown> = {
      isActive: true,
      deletedAt: null,
    };

    const flag = pickPublicFlag(q.flag);
    if (flag) filter[flag] = true;

    if (q.brand && /^[a-f\d]{24}$/i.test(String(q.brand))) {
      filter.brand = String(q.brand);
    }
    if (q.genre && /^[a-f\d]{24}$/i.test(String(q.genre))) {
      filter.genres = { $in: [String(q.genre)] };
    }

    let searchFilter: Record<string, unknown> = {};
    if (typeof q.search === 'string' && q.search.trim().length > 0) {
      const re = new RegExp(q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      searchFilter = { $or: [{ name: re }, { slug: re }, { aliases: { $in: [re] } }] };
    }

    const finalFilter = { ...filter, ...searchFilter };

    const page = parsePositiveInt(q.page, 1);
    const limit = parsePositiveInt(q.limit, 12, 100);
    const skip = (page - 1) * limit;

    // Default sort: -createdAt; flag-based sections use their natural
    // ordering (most-recently-flagged first).
    let sort: Record<string, 1 | -1> = { createdAt: -1, _id: -1 };
    if (flag === 'bestSelling') sort = { bestSelling: -1, createdAt: -1, _id: -1 };
    if (flag === 'topRated') sort = { averageRating: -1, reviewCount: -1, _id: -1 };
    if (flag === 'newArrival') sort = { newArrival: -1, createdAt: -1, _id: -1 };
    if (flag === 'featured') sort = { featured: -1, createdAt: -1, _id: -1 };
    if (q.sort === '-createdAt') sort = { createdAt: -1, _id: -1 };
    if (q.sort === 'createdAt') sort = { createdAt: 1, _id: 1 };
    if (q.sort === 'name') sort = { name: 1, _id: 1 };
    if (q.sort === '-name') sort = { name: -1, _id: -1 };
    if (q.sort === 'price') sort = { 'variants.0.price': 1, _id: 1 };

    const [raw, total] = await Promise.all([
      Product.find(finalFilter)
        .populate(POPULATE)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      Product.countDocuments(finalFilter).exec(),
    ]);

    const results = raw.map((d) => {
      const doc = d as unknown as Record<string, unknown>;
      if (doc._id && doc.id === undefined) doc.id = String(doc._id);
      delete doc._id;
      delete doc.__v;
      return toPublicProduct(doc);
    });

    return sendResponse(res, {
      message: 'Products fetched',
      data: {
        results,
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    });
  }
);

/**
 * GET /api/public/products/:slugOrId
 *
 * Single product detail. Accepts either a 24-hex ObjectId or a slug.
 * Returns 404 (not 403) for soft-deleted / inactive products — we never
 * leak the existence of an inactive product to the storefront.
 */
export const getPublicProductBySlugOrId = asyncHandler(
  async (req: Request, res: Response) => {
    const key = String(req.params.slugOrId ?? '').trim();
    if (key.length === 0) {
      return sendError(res, 400, 'Product slug or id is required');
    }

    const isId = /^[a-f\d]{24}$/i.test(key);
    const filter: Record<string, unknown> = {
      isActive: true,
      deletedAt: null,
    };
    if (isId) filter._id = key;
    else filter.slug = key;

    const doc = await Product.findOne(filter)
      .populate([
        'brand',
        'genres',
        'notes.top',
        'notes.middle',
        'notes.base',
        'seasons',
        'occasions',
        'weathers',
        'times',
        'defaultAtomizer',
      ])
      .exec();
    if (!doc) {
      return sendError(res, 404, 'Product not found');
    }
    const data: PublicProduct = toPublicProduct(doc);
    return sendResponse(res, { message: 'Product fetched', data });
  }
);

/**
 * GET /api/public/products/slugs/all
 *
 * Slug list for `generateStaticParams` in the Next.js app. Returns up to
 * 500 slugs (sufficient for an initial storefront). The full list lives in
 * the DB; this is a deliberate trade-off — once we exceed 500 active
 * products we'll switch to on-demand ISR and drop this endpoint.
 */
export const listPublicProductSlugs = asyncHandler(
  async (_req: Request, res: Response) => {
    const rows = await Product.find({ isActive: true, deletedAt: null })
      .select('slug')
      .limit(500)
      .lean()
      .exec();
    const data = rows.map((r) => String((r as Record<string, unknown>).slug ?? ''))
      .filter((s) => s.length > 0);
    return sendResponse(res, { message: 'Product slugs fetched', data });
  }
);