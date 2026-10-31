import { Product } from './product.model';
import { ApiError } from '../../utils/ApiError';
import {
  buildMongooseQuery,
  executePagedQuery,
  type PagedResult,
} from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type {
  IProduct,
  IProductImage,
  IProductVariant,
  PublicProduct,
} from './product.interface';
import { PRODUCT_QUERY_CONFIG } from './product.interface';

// ----- Populate helpers (first `ref:`/`populate()` precedent in the codebase) -----
//
// PATTERN (documented for the next module that needs refs):
//   - List:  `executePagedQuery` already runs `.lean()`, so we run a manual
//            `Product.find(filter).populate(...).sort(...).skip(...).limit(...)`
//            for endpoints that need full population. Soft-deleted rows are
//            filtered via `filter.deletedAt: null`.
//   - Single: `Product.findById(id).populate(...)` returns a doc we then
//            map through `toPublicProduct`.
//   - The populate strings mirror the schema's `ref:` names. Unknown fields
//            are dropped silently — keep them in lockstep with the schema.

const POPULATE_LIST = ['brand', 'genres', 'seasons', 'occasions', 'weathers', 'times'];
const POPULATE_SINGLE = [
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
];

// ----- Mapping helpers -----

function normalizeImages(input: unknown): IProductImage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      url: String(v.url ?? '').trim(),
      fileId: String(v.fileId ?? '').trim(),
      alt: typeof v.alt === 'string' ? v.alt.trim() : '',
    }))
    .filter((v) => v.url.length > 0 && v.fileId.length > 0);
}

function normalizeVariants(input: unknown): IProductVariant[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      size: v.size as IProductVariant['size'],
      price: Number(v.price ?? 0),
      // Absent `isActive` means "active" — pre-existing rows keep selling.
      isActive: v.isActive !== false,
    }));
}

function normalizeAliases(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((v) => String(v).trim()).filter(Boolean);
}

// Convert a `string | ObjectId` value to its stringified form for the public API.
function toId(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'toString' in v) {
    return String((v as { toString(): string }).toString());
  }
  return '';
}

function pickPopulated<T>(v: unknown): T | null {
  if (!v || typeof v !== 'object') return null;
  return v as T;
}

function pickPopulatedArray<T>(v: unknown): T[] {
  if (!Array.isArray(v)) return [];
  return v as T[];
}

/**
 * Maps a raw Product document (populated or lean) into the public shape.
 * Accepts nullable input — soft-deleted callers should pass `null` and
 * the function throws `ApiError.notFound` for unrecognised ids.
 */
export function toPublicProduct(doc: unknown): PublicProduct {
  const raw = doc as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
    deletedAt?: Date | null;
    notes?: { top?: unknown[]; middle?: unknown[]; base?: unknown[] };
  };
  if (!raw) throw ApiError.notFound('Product not found');
  const id = toId(raw._id || raw.id);

  return {
    id,
    name: String(raw.name ?? ''),
    slug: String(raw.slug ?? ''),
    brand: pickPopulated(raw.brand),
    genres: pickPopulatedArray(raw.genres),
    description: String(raw.description ?? ''),
    notes: {
      top: pickPopulatedArray(raw.notes?.top ?? []),
      middle: pickPopulatedArray(raw.notes?.middle ?? []),
      base: pickPopulatedArray(raw.notes?.base ?? []),
    },
    gender: (raw.gender as PublicProduct['gender']) ?? 'unisex',
    seasons: pickPopulatedArray(raw.seasons ?? []),
    occasions: pickPopulatedArray(raw.occasions ?? []),
    weathers: pickPopulatedArray(raw.weathers ?? []),
    times: pickPopulatedArray(raw.times ?? []),
    performance: (raw.performance as PublicProduct['performance']) ?? {
      longevity: 'moderate',
      projection: 'moderate',
      versatility: 'moderate',
    },
    images: normalizeImages(raw.images),
    variants: normalizeVariants(raw.variants),
    defaultAtomizer: pickPopulated(raw.defaultAtomizer),
    aliases: normalizeAliases(raw.aliases),
    averageRating: typeof raw.averageRating === 'number' ? raw.averageRating : 0,
    reviewCount: typeof raw.reviewCount === 'number' ? raw.reviewCount : 0,
    featured: raw.featured === true,
    bestSelling: raw.bestSelling === true,
    topRated: raw.topRated === true,
    newArrival: raw.newArrival === true,
    isActive: raw.isActive !== false,
    deletedAt: raw.deletedAt ? raw.deletedAt.toISOString() : null,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

// ----- Service functions -----

export async function createProduct(input: Partial<IProduct>): Promise<PublicProduct> {
  const doc = await Product.create(input);
  const populated = await Product.findById(doc._id).populate(POPULATE_SINGLE);
  return toPublicProduct(populated);
}

export async function listProducts(
  queryStr: Record<string, unknown>
): Promise<PagedResult<PublicProduct>> {
  const includeDeleted = queryStr.includeDeleted === 'true';
  const { filter, sort, skip, limit, page } = buildMongooseQuery<IProduct>(
    queryStr,
    PRODUCT_QUERY_CONFIG
  );
  const finalFilter = includeDeleted
    ? filter
    : ({ ...filter, deletedAt: null } as typeof filter);

  const [raw, total] = await Promise.all([
    Product.find(finalFilter)
      .populate(POPULATE_LIST)
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

  return {
    results,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

export async function getProductById(id: string): Promise<PublicProduct> {
  const doc = await Product.findOne({ _id: id, deletedAt: null }).populate(
    POPULATE_SINGLE
  );
  if (!doc) throw ApiError.notFound('Product not found');
  return toPublicProduct(doc);
}

const WRITABLE_PRODUCT_KEYS = [
  'name',
  'slug',
  'brand',
  'genres',
  'description',
  'notes',
  'gender',
  'seasons',
  'occasions',
  'weathers',
  'times',
  'performance',
  'images',
  'variants',
  'defaultAtomizer',
  'aliases',
  'featured',
  'bestSelling',
  'topRated',
  'newArrival',
  'isActive',
] as const;

export async function updateProduct(
  id: string,
  input: Partial<IProduct>
): Promise<PublicProduct> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_PRODUCT_KEYS
  );
  const doc = await Product.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Product not found');
  const populated = await Product.findById(doc._id).populate(POPULATE_SINGLE);
  return toPublicProduct(populated);
}

/**
 * Soft-delete: keep the document but mark it inactive + tombstoned. Inventory
 * and inventory-logs rows that referenced the product are untouched (they
 * remain as audit trail). ImageKit cleanup runs only on hard purge (future).
 */
export async function deleteProduct(id: string): Promise<PublicProduct> {
  const doc = await Product.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: new Date(), isActive: false } },
    { new: true }
  );
  if (!doc) throw ApiError.notFound('Product not found');
  const populated = await Product.findById(doc._id).populate(POPULATE_SINGLE);
  return toPublicProduct(populated);
}

export async function restoreProduct(id: string): Promise<PublicProduct> {
  const doc = await Product.findOneAndUpdate(
    { _id: id },
    { $set: { deletedAt: null, isActive: true } },
    { new: true }
  );
  if (!doc) throw ApiError.notFound('Product not found');
  const populated = await Product.findById(doc._id).populate(POPULATE_SINGLE);
  return toPublicProduct(populated);
}

interface UpdateImagesInput {
  add?: IProductImage[];
  remove?: string[];   // fileId[]
  reorder?: string[];  // fileId[] in desired order
}

/**
 * Deduplicates image operations, applies them in a single update, and fires
 * fire-and-forget ImageKit cleanups for every removed fileId.
 */
export async function updateProductImages(
  id: string,
  input: UpdateImagesInput
): Promise<PublicProduct> {
  const doc = await Product.findOne({ _id: id, deletedAt: null });
  if (!doc) throw ApiError.notFound('Product not found');

  const current: IProductImage[] = Array.isArray(doc.images)
    ? (doc.images as unknown as IProductImage[]).map((img) => ({
        url: img.url,
        fileId: img.fileId,
        alt: img.alt ?? '',
      }))
    : [];

  const byId = new Map(current.map((img) => [img.fileId, img]));
  const removeIds = new Set(input.remove ?? []);
  const addList = input.add ?? [];

  // 1. Remove.
  for (const fid of removeIds) {
    byId.delete(fid);
  }
  // 2. Add (de-dup by fileId — latest write wins).
  for (const img of addList) {
    byId.set(img.fileId, img);
  }

  // 3. Reorder (if a complete order is given, use it; otherwise append).
  let next: IProductImage[];
  if (input.reorder && input.reorder.length > 0) {
    const reordered: IProductImage[] = [];
    for (const fid of input.reorder) {
      const img = byId.get(fid);
      if (img) {
        reordered.push(img);
        byId.delete(fid);
      }
    }
    // Any images not named in reorder go to the end (preserves them).
    for (const img of byId.values()) reordered.push(img);
    next = reordered;
  } else {
    next = Array.from(byId.values());
  }

  await Product.updateOne({ _id: id }, { $set: { images: next } });

  // 4. Fire-and-forget ImageKit deletes for every removed fileId.
  for (const fid of removeIds) {
    if (fid) void deleteImageKitFile(fid);
  }

  const populated = await Product.findById(id).populate(POPULATE_SINGLE);
  return toPublicProduct(populated);
}
