import type { FilterQuery, Model, SortOrder } from 'mongoose';

/**
 * Per-module whitelist for filterable query-string keys.
 * Anything not declared here is silently dropped by the builder.
 *
 * Types:
 *   - `boolean`           : coerces 'true'/'false' → boolean. Unknown values drop.
 *   - `string`            : exact-match string.
 *   - `number`            : coerces to finite number. Drops on NaN.
 *   - `enum:<csv>`        : exact match against the allowed CSV values.
 *   - `csv`               : splits on comma into an $in array.
 *   - `csvTextSearch`     : splits on comma; each value is a regex pattern.
 *                           Builds `{ key: { $in: [RegExp, ...] } }` — used
 *                           for matching against any element in an array
 *                           field like Product.aliases[].
 *   - `snapshotText`      : exact-match string (alias of `string`, kept for
 *                           semantic clarity on denormalised snapshot fields
 *                           like Inventory.productName).
 *   - `objectId`          : validates 24-hex chars; drops invalid.
 *   - `{ type: 'dateRange', from, to }`            : builds createdAt range filter.
 *   - `{ type: 'numberRange', from, to, target }`  : builds $gte/$lte on `target`.
 *
 * Array-aware search: when `?search=` is set, any `searchFields` entry
 * declared as an `arrayField` in the config (via `searchArrayFields`) is
 * searched with `{ field: { $in: [regex] } }` instead of `{ field: regex }`,
 * so it matches if ANY element of the array contains the substring.
 */
export type QueryFilterSpec =
  | 'boolean'
  | 'string'
  | 'number'
  | 'csv'
  | 'csvTextSearch'
  | 'snapshotText'
  | 'objectId'
  | string
  | { type: 'dateRange'; from: string; to: string }
  | { type: 'numberRange'; from: string; to: string; target: string };

export interface QueryConfig {
  /** Fields searched when `?search=` is set (OR-across, case-insensitive substring). */
  searchFields: string[];
  /**
   * Subset of `searchFields` whose target schema path is an array of strings.
   * Each is searched as `{ field: { $in: [RegExp] } }` so any element match
   * counts. Scalar fields fall through to the regular `{ field: regex }` form.
   */
  searchArrayFields?: readonly string[];
  /** Whitelist of filterable query params + their coercion type. */
  allowedFilters: Record<string, QueryFilterSpec>;
  /** Default sort when `?sort=` is missing or invalid. */
  defaultSort?: string;
  /** Hard ceiling on `?limit=`. Defaults to 100. */
  maxLimit?: number;
}

export interface BuiltQuery<T> {
  filter: FilterQuery<T>;
  sort: Record<string, SortOrder>;
  skip: number;
  limit: number;
  page: number;
}

/** Mongo's reserved keys — never treat as user-provided filters. */
const RESERVED_KEYS = new Set(['search', 'page', 'limit', 'sort']);

function asString(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function coerceBoolean(v: unknown): boolean | null {
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}

function coerceNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isObjectId(v: unknown): boolean {
  return typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
}

/** Parse `?sort=-createdAt,name` into a Mongoose sort object. */
function parseSort(raw: unknown, defaultSort: string): Record<string, SortOrder> {
  const src = typeof raw === 'string' && raw.length > 0 ? raw : defaultSort;
  const out: Record<string, SortOrder> = {};
  for (const token of src.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (token.startsWith('-')) out[token.slice(1)] = -1;
    else out[token] = 1;
  }
  return out;
}

/**
 * Translate one query-string key into a Mongo filter fragment,
 * honouring the `allowedFilters` whitelist and per-key coercion.
 */
function buildFilterFragment(
  key: string,
  raw: unknown,
  spec: QueryFilterSpec
): Record<string, unknown> | null {
  // Plain primitive specs.
  if (spec === 'boolean') {
    const b = coerceBoolean(raw);
    return b === null ? null : { [key]: b };
  }
  if (spec === 'number') {
    const n = coerceNumber(raw);
    return n === null ? null : { [key]: n };
  }
  if (spec === 'string') {
    const s = asString(raw);
    return s ? { [key]: s } : null;
  }
  if (spec === 'csv') {
    const s = asString(raw);
    if (!s) return null;
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
    return arr.length ? { [key]: { $in: arr } } : null;
  }
  if (spec === 'csvTextSearch') {
    // Splits on comma; each value becomes a case-insensitive substring
    // regex wrapped in $in — used against array fields where any element
    // matching is sufficient.
    const s = asString(raw);
    if (!s) return null;
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
    if (arr.length === 0) return null;
    const res = arr.map((p) => new RegExp(escapeRegex(p), 'i'));
    return { [key]: { $in: res } };
  }
  if (spec === 'snapshotText') {
    // Alias of 'string' for denormalised snapshot fields. Exact match.
    const s = asString(raw);
    return s ? { [key]: s } : null;
  }
  if (spec === 'objectId') {
    return isObjectId(raw) ? { [key]: String(raw) } : null;
  }
  // enum:<csv>
  if (typeof spec === 'string' && spec.startsWith('enum:')) {
    const allowed = spec.slice(5).split(',').map((s) => s.trim());
    const v = asString(raw);
    return allowed.includes(v) ? { [key]: v } : null;
  }
  // Range specs.
  if (typeof spec === 'object' && spec.type === 'dateRange') {
    const range: Record<string, Date> = {};
    if (raw && typeof raw === 'object') {
      const bag = raw as Record<string, unknown>;
      const f = new Date(String(bag[spec.from] ?? ''));
      const t = new Date(String(bag[spec.to] ?? ''));
      if (!Number.isNaN(f.getTime())) range.$gte = f;
      if (!Number.isNaN(t.getTime())) range.$lte = t;
    }
    return Object.keys(range).length ? { [key]: range } : null;
  }
  if (typeof spec === 'object' && spec.type === 'numberRange') {
    if (!raw || typeof raw !== 'object') return null;
    const bag = raw as Record<string, unknown>;
    const range: Record<string, number> = {};
    const f = coerceNumber(bag[spec.from]);
    const t = coerceNumber(bag[spec.to]);
    if (f !== null) range.$gte = f;
    if (t !== null) range.$lte = t;
    return Object.keys(range).length ? { [spec.target]: range } : null;
  }
  return null;
}

/**
 * Build a Mongo query + sort/skip/limit from an Express `req.query`-shaped object.
 *
 * Whitelist-first: every key in `queryStr` is checked against `config.allowedFilters`
 * (and the reserved search/page/limit/sort set). Unrecognised keys are dropped, which
 * keeps accidental field probing from leaking privileged fields.
 */
export function buildMongooseQuery<T>(
  queryStr: Record<string, unknown>,
  config: QueryConfig
): BuiltQuery<T> {
  const filter: Record<string, unknown> = {};

  // 1. Search — OR-across configured fields, case-insensitive substring.
  const search = asString(queryStr.search).trim();
  if (search && config.searchFields.length > 0) {
    const re = new RegExp(escapeRegex(search), 'i');
    const arrayFields = new Set(config.searchArrayFields ?? []);
    filter.$or = config.searchFields.map((f) =>
      arrayFields.has(f) ? { [f]: { $in: [re] } } : { [f]: re }
    );
  }

  // 2. Whitelisted filters.
  for (const [key, spec] of Object.entries(config.allowedFilters)) {
    if (!(key in queryStr)) continue;
    const fragment = buildFilterFragment(key, queryStr[key], spec);
    if (fragment) Object.assign(filter, fragment);
  }

  // 3. Sort + pagination.
  const sort = parseSort(queryStr.sort, config.defaultSort ?? '-createdAt');
  // Always tie-break on _id so identical timestamps don't shuffle rows across pages.
  sort._id = sort._id ?? 1;

  const maxLimit = config.maxLimit ?? 100;
  const page = Math.max(1, coerceNumber(queryStr.page) ?? 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, coerceNumber(queryStr.limit) ?? 10)
  );

  return {
    filter: filter as FilterQuery<T>,
    sort,
    skip: (page - 1) * limit,
    limit,
    page,
  };
}

/** Result shape returned to the controller for a paginated endpoint. */
export interface PagedResult<T> {
  results: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Run a paginated query against a Mongoose model and return both the slice
 * and the metadata the frontend needs to render pagination controls.
 *
 * Handlers stay two-liners:
 *   const data = await executePagedQuery(Brand, req.query, BRAND_QUERY_CONFIG);
 *   return sendResponse(res, { message: 'Brands fetched', data });
 *
 * `.lean()` skips Mongoose document hydration, so the schema's `toJSON`/
 * `toObject` transforms (which rename `_id` → `id`) never fire. We re-apply
 * that rename here so list results have the same `{ id, ... }` shape the
 * `getById`/`create`/`update` paths return via `toPublic*()`.
 */
export async function executePagedQuery<T>(
  Model: Model<T>,
  queryStr: Record<string, unknown>,
  config: QueryConfig
): Promise<PagedResult<T>> {
  const { filter, sort, skip, limit, page } = buildMongooseQuery<T>(
    queryStr,
    config
  );
  const [raw, total] = await Promise.all([
    Model.find(filter).sort(sort).skip(skip).limit(limit).lean<T[]>().exec(),
    Model.countDocuments(filter).exec(),
  ]);
  const results = raw.map((doc) => {
    const d = doc as unknown as Record<string, unknown>;
    if (d._id !== undefined && d.id === undefined) {
      d.id = String(d._id);
    }
    delete d._id;
    delete d.__v;
    return d as T;
  });
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return { results, page, limit, total, totalPages };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Helper for soft-delete-aware modules: constrains the built filter to
 * active rows only (i.e. `deletedAt` is null/undefined). Modules that
 * support a `?includeDeleted=true` flag should branch on it themselves
 * before calling this.
 */
export function withActiveOnly<T>(built: BuiltQuery<T>): BuiltQuery<T> {
  return {
    ...built,
    filter: { ...built.filter, deletedAt: null } as FilterQuery<T>,
  };
}
