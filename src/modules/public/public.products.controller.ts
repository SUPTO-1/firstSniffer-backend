import type { Request, Response } from 'express';
import { Product } from '../product/product.model';
import { InventoryBatch } from '../inventory/inventoryBatch.model';
import {
  getProductStockForProducts,
} from '../inventory/inventoryBatch.service';
import type { InventoryStatus } from '../inventory/inventoryBatch.interface';
import { sendResponse, sendError } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import type { PublicProduct } from '../product/product.interface';
import {
  buildPublicProductFilter,
  wantsInStock,
  withInStockIds,
  resolvePublicSort,
  PUBLIC_PRODUCT_SORTS,
  variantPriceBounds,
} from './publicProductFilter';
import {
  applyCrossCollectionSearch,
} from './publicSearchResolution';

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
  search?: string;
  sort?: string;
  limit?: number;
  page?: number;
  brands?: string;
  genres?: string;
  seasons?: string;
  occasions?: string;
  weathers?: string;
  times?: string;
  'notes.top'?: string;
  'notes.middle'?: string;
  'notes.base'?: string;
  gender?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: string;
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
 * Attach the derived `priceRange` the storefront needs. `variants[]` may be
 * missing on a lean row, so we compute `[lowest, highest]` defensively.
 */
function withDerived<T>(doc: T): T & { priceRange: { min: number | null; max: number | null } } {
  const bounds = variantPriceBounds(
    (doc as unknown as Record<string, unknown>).variants
  );
  (doc as unknown as Record<string, unknown>).priceRange = {
    min: bounds.min,
    max: bounds.max,
  };
  return doc as T & { priceRange: { min: number | null; max: number | null } };
}

/**
 * Product ids that have sellable stock right now.
 *
 * Stock is a PRODUCT-level pool: a product may have several purchase
 * batches and every selling size draws from the same millilitres. So a
 * product is "in stock" when its AGGREGATE remaining ml across batches
 * minus its safety buffer is above zero — not when any single batch row
 * happens to have `remainingMl > 0`.
 *
 * Returned as raw ids so the caller can `$in` them.
 */
async function inStockProductIds(): Promise<string[]> {
  const rows = await InventoryBatch.find({ isActive: true })
    .select('product remainingMl')
    .limit(20_000)
    .lean()
    .exec();

  const remainingByProduct = new Map<string, number>();
  for (const r of rows) {
    const id = String((r as { product?: unknown }).product ?? '');
    if (!id) continue;
    remainingByProduct.set(
      id,
      (remainingByProduct.get(id) ?? 0) + Number((r as { remainingMl?: number }).remainingMl ?? 0)
    );
  }

  if (remainingByProduct.size === 0) return [];

  // Apply the per-product safety buffer — it is enforced, so it must be
  // subtracted before deciding whether a product is purchasable.
  const products = await Product.find({
    _id: { $in: [...remainingByProduct.keys()] },
  })
    .select('safetyBufferMl')
    .lean()
    .exec();
  const bufferById = new Map(
    products.map((p) => [
      String(p._id),
      Math.max(0, Number(p.safetyBufferMl ?? 0)),
    ])
  );

  const ids: string[] = [];
  for (const [id, remaining] of remainingByProduct.entries()) {
    const sellable = remaining - (bufferById.get(id) ?? 0);
    if (sellable > 0) ids.push(id);
  }
  return ids;
}

/**
 * Attach the product-level stock summary the storefront needs.
 *
 * `stock.totalMl` is the physical capacity on hand, `stock.sellableMl`
 * is what a customer can actually buy (remaining minus the safety
 * buffer), and `stock.status` drives the "Only X ml left" badge.
 */
async function withStock<T extends { id?: string }>(docs: T[]): Promise<
  Array<T & { stock: { totalMl: number; sellableMl: number; status: InventoryStatus } }>
> {
  const ids = docs.map((d) => String(d.id ?? '')).filter(Boolean);
  if (ids.length === 0) {
    return docs.map((d) => ({
      ...d,
      stock: { totalMl: 0, sellableMl: 0, status: 'out_of_stock' as InventoryStatus },
    }));
  }

  const stockByProduct = await getProductStockForProducts(ids);
  return docs.map((d) => {
    const stock = stockByProduct.get(String(d.id ?? ''));
    return {
      ...d,
      stock: {
        totalMl: stock?.totalMl ?? 0,
        sellableMl: stock?.sellableMl ?? 0,
        status: stock?.status ?? ('out_of_stock' as InventoryStatus),
      },
    };
  });
}

/**
 * Strip DISABLED selling variants from a public payload.
 *
 * A disabled variant is not purchasable, so the storefront must not
 * offer it. The admin surface still sees them (it reads the admin
 * product endpoint, not this one).
 */
function withoutDisabledVariants<T extends { variants?: unknown }>(doc: T): T {
  const variants = (doc as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return doc;
  (doc as { variants: unknown[] }).variants = variants.filter((v) => {
    const isActive = (v as { isActive?: boolean })?.isActive;
    return isActive !== false;
  });
  return doc;
}

/**
 * Fold cross-collection search hits into the product filter.
 *
 * Delegates to `applyCrossCollectionSearch` in publicSearchResolution, which
 * resolves the taxonomy ids PER TOKEN — essential for "AND across tokens":
 * `?search=oud wood` must require an oud somewhere AND wood somewhere, not
 * accept any product matching either term.
 */
async function applySearchToFilter(
  filter: Record<string, unknown>,
  searchTerm: string
): Promise<void> {
  const and = (filter.$and as Record<string, unknown>[] | undefined) ?? [];
  filter.$and = and;
  await applyCrossCollectionSearch(and, searchTerm);
}

/**
 * GET /api/public/products
 *
 * Public storefront listing with full faceted search.
 *
 * Semantics (enforced in the DB query, not just the UI):
 *   - OR within a category  → `?brands=a,b` matches either
 *   - AND across categories → `?brands=a,b&genres=x` must match both
 *   - notes are OR within their own layer — selecting 3 top notes does NOT
 *     require a product to carry all three
 *   - an empty / absent facet contributes no clause at all
 *
 * Query params: `search`, `brands`, `genres`, `seasons`, `occasions`,
 * `weathers`, `times`, `notes.top`, `notes.middle`, `notes.base` (all CSV),
 * `gender`, `minPrice`, `maxPrice`, `inStock`, `flag`, `sort`, `page`, `limit`.
 */
export const listPublicProducts = asyncHandler(
  async (req: Request, res: Response) => {
    const q = req.query as PublicProductQuery;

    const built = buildPublicProductFilter({
      search: q.search,
      facets: {
        brands: q.brands,
        genres: q.genres,
        seasons: q.seasons,
        occasions: q.occasions,
        weathers: q.weathers,
        times: q.times,
        'notes.top': q['notes.top'],
        'notes.middle': q['notes.middle'],
        'notes.base': q['notes.base'],
      },
      gender: q.gender,
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
    });

    // Cross-collection search (brand/note/taxonomy names) — needs extra queries
    // so it runs after the base filter is assembled.
    if (built.searchTerm) {
      await applySearchToFilter(
        built.filter as Record<string, unknown>,
        built.searchTerm
      );
    }

    // Availability — resolved to a product-id set so the main query stays a
    // simple indexed `_id $in`.
    if (wantsInStock(q.inStock)) {
      withInStockIds(built, await inStockProductIds());
    }

    const filter = built.filter;

    const flag = pickPublicFlag(q.flag);
    if (flag) {
      const and = ((filter as Record<string, unknown>).$and as
        | Record<string, unknown>[]
        | undefined) ?? [];
      and.push({ [flag]: true });
      (filter as Record<string, unknown>).$and = and;
    }

    const page = parsePositiveInt(q.page, 1);
    const limit = parsePositiveInt(q.limit, 12, 60);
    const skip = (page - 1) * limit;

    // Default sort: newest. Flag-based sections use their natural ordering.
    let sort = resolvePublicSort(q.sort) ?? PUBLIC_PRODUCT_SORTS.newest;
    if (!q.sort && flag === 'bestSelling') sort = PUBLIC_PRODUCT_SORTS.popular;
    if (!q.sort && flag === 'topRated') sort = PUBLIC_PRODUCT_SORTS.rating;

    const [raw, total] = await Promise.all([
      Product.find(filter)
        .populate(POPULATE)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      Product.countDocuments(filter).exec(),
    ]);

    const results = raw.map((d) => {
      const doc = d as unknown as Record<string, unknown>;
      if (doc._id && doc.id === undefined) doc.id = String(doc._id);
      delete doc._id;
      delete doc.__v;
      return withDerived(doc);
    }) as unknown as Array<PublicProduct & { priceRange: { min: number | null; max: number | null } }>;

    // Disabled selling variants are not offered on the storefront.
    for (const doc of results) withoutDisabledVariants(doc);

    // Product-level stock summary (total / sellable / status).
    const withStockResults = await withStock(results);

    return sendResponse(res, {
      message: 'Products fetched',
      data: {
        results: withStockResults,
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
    const leanDoc = doc.toObject() as unknown as Record<string, unknown>;
    if (leanDoc._id && leanDoc.id === undefined) {
      leanDoc.id = String(leanDoc._id);
    }
    delete leanDoc._id;
    delete leanDoc.__v;
    const data = withDerived(leanDoc) as unknown as PublicProduct;
    // Disabled selling variants are not offered on the storefront.
    withoutDisabledVariants(data);
    const [withStockData] = await withStock([data]);
    return sendResponse(res, { message: 'Product fetched', data: withStockData });
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