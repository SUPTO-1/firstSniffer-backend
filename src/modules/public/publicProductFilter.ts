import { Types } from 'mongoose';
import type { FilterQuery } from 'mongoose';
import type { IProduct } from '../product/product.interface';

/**
 * Facet whitelist for the public storefront listing.
 *
 * Each entry maps a URL query key to the Product path it constrains. A key
 * whose value is absent (or an empty CSV) contributes NO clause at all — an
 * empty category must never restrict the result set.
 *
 * OR-within / AND-across is expressed structurally: every facet becomes one
 * `{ path: { $in: [...] } }` fragment, and Mongo ANDs all top-level keys. So
 * `?brands=a,b&genres=x,y` ⇒ `(brand ∈ {a,b}) AND (genres ∈ {x,y})`.
 */
export interface PublicFacetSpec {
  /** Product path this facet constrains. */
  path: string;
  /** Max values accepted in the CSV (guards against absurd query strings). */
  max?: number;
}

/**
 * The storefront's facet map. `brand` is included here even though the admin
 * `PRODUCT_QUERY_CONFIG` treats it as a single `objectId` — the storefront
 * needs multi-select ("show Dior AND Chanel together").
 */
export const PUBLIC_FACETS: Record<string, PublicFacetSpec> = {
  brands: { path: 'brand', max: 30 },
  genres: { path: 'genres', max: 30 },
  seasons: { path: 'seasons', max: 30 },
  occasions: { path: 'occasions', max: 30 },
  weathers: { path: 'weathers', max: 30 },
  times: { path: 'times', max: 30 },
  'notes.top': { path: 'notes.top', max: 40 },
  'notes.middle': { path: 'notes.middle', max: 40 },
  'notes.base': { path: 'notes.base', max: 40 },
};

/** Max CSV values we'll accept before truncating (global safety cap). */
const GLOBAL_FACET_CAP = 40;
/** Hard ceiling on a single ObjectId in a CSV — 24 hex chars. */
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
/** Longest search term we run a regex against. */
const MAX_SEARCH_LENGTH = 120;

const GENDERS = new Set(['masculine', 'feminine', 'unisex']);

/**
 * Parse `?brands=a,b,c` into a de-duplicated list of valid ObjectIds.
 * Invalid ids are dropped rather than 400ing — a stale bookmarked URL
 * should degrade to "no brand filter", not an error page.
 */
export function parseIdCsv(raw: unknown, max = GLOBAL_FACET_CAP): string[] {
  if (raw === undefined || raw === null) return [];
  const cap = Math.min(max, GLOBAL_FACET_CAP);
  const seen = new Set<string>();
  for (const part of String(raw).split(',')) {
    const v = part.trim();
    if (v && OBJECT_ID_RE.test(v)) seen.add(v.toLowerCase());
    if (seen.size >= cap) break;
  }
  return Array.from(seen);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-anchored prefix regex for a token.
 *
 * `\b` only asserts a boundary when the adjacent char is a word character, so
 * a token starting with punctuation (`#4`, `-ex`) would never match. In that
 * case we fall back to a plain escaped substring.
 */
function tokenRegex(token: string): RegExp {
  const escaped = escapeRegex(token);
  const startsWithWordChar = /^[\p{L}\p{N}_]/u.test(token);
  return startsWithWordChar
    ? new RegExp(`\\b${escaped}`, 'iu')
    : new RegExp(escaped, 'iu');
}

/**
 * Normalise a raw search term:
 *   - collapse internal runs of whitespace to a single space (so "chan  nel"
 *     behaves like "chan nel" instead of failing on the double space),
 *   - trim,
 *   - clamp length,
 *   - lowercase (Mongo regexes here are case-insensitive anyway, but keeping
 *     one normalised form makes the tokens reusable).
 */
export function normalizeSearchTerm(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_LENGTH).toLowerCase();
}

/**
 * Build one regex clause per token for a given field.
 *
 * Tokens use a word-anchored prefix match so `search=oud` hits "Oud" and
 * "Oud Wood" but NOT "Cloudy" — a plain substring regex there produces
 * confidently wrong results. Multi-token terms therefore yield N clauses that
 * the caller ANDs together (all words must appear, in any order, anywhere on
 * the product across any of the searched fields).
 */
function searchClausesForField(
  field: string,
  isArrayField: boolean,
  tokens: string[]
): Record<string, unknown>[] {
  if (tokens.length === 0) return [];
  return tokens.map((tok) => {
    const re = tokenRegex(tok);
    return isArrayField ? { [field]: { $in: [re] } } : { [field]: re };
  });
}

export interface PublicProductFilterInput {
  search?: unknown;
  /** Multiselect facets keyed by PUBLIC_FACETS key (CSV strings). */
  facets?: Record<string, unknown>;
  gender?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  /** `true` keeps only products with at least one inventory row in stock. */
  inStock?: unknown;
}

export interface BuiltPublicProductFilter {
  filter: FilterQuery<IProduct>;
  /** Product ids that have stock; `null` when the availability filter is off. */
  inStockIds: string[] | null;
  /** Facets that actually produced a clause (for chip rendering). */
  appliedFacets: Record<string, string[]>;
  /** Normalised search term ('' when absent). */
  searchTerm: string;
  priceRange: { min?: number; max?: number };
}

function coerceFiniteNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function coerceBool(raw: unknown): boolean {
  const s = String(raw).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * Build the Mongo filter for the storefront listing.
 *
 * Guarantees:
 *   - OR within a category, AND across categories,
 *   - notes use a single `$in` per note layer — a product matching *one* of
 *     the selected top notes still qualifies (never all-of),
 *   - an empty/absent facet adds no clause,
 *   - `inStock` resolves to a product-id set the caller can `$in` on.
 */
export function buildPublicProductFilter(
  input: PublicProductFilterInput
): BuiltPublicProductFilter {
  // Base visibility rules — public callers never see inactive or deleted rows.
  const filter: Record<string, unknown> = {
    isActive: true,
    deletedAt: null,
  };
  // Every remaining clause is ANDed together. Using an explicit `$and` array
  // (rather than spreading keys onto the top level) means a facet can never
  // clobber another's key, and `$or` from the search block composes safely.
  const and: Record<string, unknown>[] = [];

  // ---- Search: AND across tokens, OR across fields -----------------------
  const searchTerm = normalizeSearchTerm(input.search);
  if (searchTerm) {
    const tokens = searchTerm.split(' ').filter(Boolean);
    // Scalars match the full phrase; arrays match any token in any element.
    const scalarFields = ['name', 'slug', 'description', 'brandName', 'aliases'];
    const fieldClauses: Record<string, unknown>[] = [];
    for (const field of scalarFields) {
      fieldClauses.push(
        ...searchClausesForField(field, field === 'aliases', tokens)
      );
    }
    // Notes and taxonomy are searched by NAME, which lives on another
    // collection — those are resolved to ids in a second pass by the
    // controller (`searchNoteIds` / `searchTaxonomyIds`) and injected here.
    and.push({ $or: fieldClauses });
  }

  // ---- Facets: OR within, AND across -------------------------------------
  const appliedFacets: Record<string, string[]> = {};
  for (const [key, spec] of Object.entries(PUBLIC_FACETS)) {
    const raw = input.facets?.[key];
    const ids = parseIdCsv(raw, spec.max ?? GLOBAL_FACET_CAP);
    if (ids.length === 0) continue;
    appliedFacets[key] = ids;
    // Cast to real ObjectIds rather than leaving 24-char strings.
    //
    // `find()` and `countDocuments()` run through Mongoose's query caster, so
    // strings work there — but `aggregate()` bypasses casting entirely and
    // would silently match NOTHING against an ObjectId-typed field. Since the
    // facet-counts endpoint is aggregation-based, every id is cast up front so
    // the same filter object is correct on every code path.
    and.push({ [spec.path]: { $in: ids.map((id) => new Types.ObjectId(id)) } });
  }

  // ---- Gender ------------------------------------------------------------
  const genderRaw = typeof input.gender === 'string' ? input.gender.trim() : '';
  if (genderRaw && GENDERS.has(genderRaw)) {
    and.push({ gender: genderRaw });
  }

  // ---- Price range -------------------------------------------------------
  // Price lives on `variants[].price` and each size has its own price, so the
  // two bounds need DIFFERENT semantics:
  //
  //   minPrice — "show me the bigger bottles." Any variant at or above the
  //   bound qualifies, so `$elemMatch` + `$gte` is correct.
  //
  //   maxPrice — "show me what I can afford." A decant shopper means the ENTRY
  //   size, so the product qualifies only if its CHEAPEST variant is within
  //   budget. Using `$lte` on any variant would let a ৳900/৳2,600 product slip
  //   through a ৳1,000 slider just because a 3ml exists — showing someone a
  //   ৳2,600 bottle under a "under ৳1,000" heading. `$elemMatch` + `$not/$elemMatch`
  //   expresses "no variant exceeds the bound" without needing `$expr`.
  const min = coerceFiniteNumber(input.minPrice);
  const max = coerceFiniteNumber(input.maxPrice);
  const priceRange: { min?: number; max?: number } = {};
  if (min !== undefined) priceRange.min = min;
  if (max !== undefined) priceRange.max = max;
  if (min !== undefined) {
    and.push({ variants: { $elemMatch: { price: { $gte: min } } } });
  }
  if (max !== undefined) {
    and.push({ variants: { $not: { $elemMatch: { price: { $gt: max } } } } });
  }

  if (and.length > 0) filter.$and = and;

  return {
    filter: filter as FilterQuery<IProduct>,
    inStockIds: null,
    appliedFacets,
    searchTerm,
    priceRange,
  };
}

/**
 * Escape hatch for the controller: attach the resolved in-stock id set to a
 * built filter. Mutates and returns the same object so the call site reads as
 * one expression.
 */
export function withInStockIds(
  built: BuiltPublicProductFilter,
  ids: string[]
): BuiltPublicProductFilter {
  built.inStockIds = ids;
  if (ids.length === 0) {
    // "In stock only" matched nothing → guarantee an empty result set.
    (built.filter as Record<string, unknown>)._id = { $in: [] };
    return built;
  }
  const filter = built.filter as Record<string, unknown>;
  const and = (filter.$and as Record<string, unknown>[] | undefined) ?? [];
  and.push({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } });
  filter.$and = and;
  return built;
}

/** Whether the caller asked for stock-only results. */
export function wantsInStock(raw: unknown): boolean {
  return coerceBool(raw);
}

/**
 * Turn a Product `variants[]` array into a `[lowest, highest]` pair. Used by
 * the storefront to render "from ৳X" and by the price-range slider bounds.
 */
export function variantPriceBounds(variants: unknown): {
  min: number | null;
  max: number | null;
} {
  if (!Array.isArray(variants) || variants.length === 0) {
    return { min: null, max: null };
  }
  let min: number | null = null;
  let max: number | null = null;
  for (const v of variants) {
    const price =
      typeof v === 'object' && v !== null
        ? Number((v as { price?: unknown }).price)
        : Number(v);
    if (!Number.isFinite(price)) continue;
    if (min === null || price < min) min = price;
    if (max === null || price > max) max = price;
  }
  return { min, max };
}

export const PUBLIC_PRODUCT_SORTS = {
  newest: { createdAt: -1 as const, _id: -1 as const },
  oldest: { createdAt: 1 as const, _id: 1 as const },
  nameAsc: { name: 1 as const, _id: 1 as const },
  nameDesc: { name: -1 as const, _id: -1 as const },
  priceAsc: { 'variants.0.price': 1 as const, _id: 1 as const },
  priceDesc: { 'variants.0.price': -1 as const, _id: -1 as const },
  rating: { averageRating: -1 as const, reviewCount: -1 as const, _id: -1 as const },
  popular: { bestSelling: -1 as const, createdAt: -1 as const, _id: -1 as const },
};

/** Map a `?sort=` token onto a whitelisted sort object (null when unknown). */
export function resolvePublicSort(
  raw: unknown
): Record<string, 1 | -1> | null {
  if (typeof raw !== 'string') return null;
  const map: Record<string, Record<string, 1 | -1>> = {
    newest: PUBLIC_PRODUCT_SORTS.newest,
    '-createdAt': PUBLIC_PRODUCT_SORTS.newest,
    oldest: PUBLIC_PRODUCT_SORTS.oldest,
    createdAt: PUBLIC_PRODUCT_SORTS.oldest,
    name: PUBLIC_PRODUCT_SORTS.nameAsc,
    nameAsc: PUBLIC_PRODUCT_SORTS.nameAsc,
    '-name': PUBLIC_PRODUCT_SORTS.nameDesc,
    nameDesc: PUBLIC_PRODUCT_SORTS.nameDesc,
    price: PUBLIC_PRODUCT_SORTS.priceAsc,
    priceAsc: PUBLIC_PRODUCT_SORTS.priceAsc,
    '-price': PUBLIC_PRODUCT_SORTS.priceDesc,
    priceDesc: PUBLIC_PRODUCT_SORTS.priceDesc,
    rating: PUBLIC_PRODUCT_SORTS.rating,
    '-rating': PUBLIC_PRODUCT_SORTS.rating,
    popular: PUBLIC_PRODUCT_SORTS.popular,
    bestSelling: PUBLIC_PRODUCT_SORTS.popular,
  };
  return map[raw.trim()] ?? null;
}