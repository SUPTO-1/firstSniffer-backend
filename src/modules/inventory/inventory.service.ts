import type { ClientSession } from 'mongoose';
import { Inventory } from './inventory.model';
import { ApiError } from '../../utils/ApiError';
import {
  buildMongooseQuery,
  executePagedQuery,
  type PagedResult,
} from '../../utils/queryBuilder';
import { getSettings } from '../settings/settings.service';
import { Product } from '../product/product.model';
import { writeLog } from '../inventoryLog/inventoryLog.service';
import { pickWritable } from '../_shared/pickWritable';
import type {
  IInventory,
  InventoryDoc,
  InventoryStatus,
  PublicInventory,
  PublicInventoryProductRef,
} from './inventory.interface';
import { INVENTORY_QUERY_CONFIG } from './inventory.interface';

// ----- Mapping helpers -----

function pickPopulatedProduct(v: unknown): PublicInventoryProductRef | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Record<string, unknown>;
  const images = Array.isArray(raw.images)
    ? (raw.images as Array<{ url: string; fileId: string; alt?: string }>).map((img) => ({
        url: String(img.url ?? ''),
        fileId: String(img.fileId ?? ''),
        alt: typeof img.alt === 'string' ? img.alt : undefined,
      }))
    : [];
  return {
    id: raw._id ? String(raw._id) : '',
    name: String(raw.name ?? ''),
    slug: String(raw.slug ?? ''),
    images,
  };
}

/**
 * `status` is computed at read time from remainingMl / totalMl / threshold.
 * Order matters: out_of_stock first (zero stock regardless of total), then
 * low_stock (under threshold or under 25% capacity), else in_stock.
 */
export function computeStatus(
  remainingMl: number,
  totalMl: number,
  lowStockThresholdMl: number
): InventoryStatus {
  if (remainingMl <= 0) return 'out_of_stock';
  if (remainingMl <= lowStockThresholdMl) return 'low_stock';
  if (totalMl > 0 && remainingMl < totalMl * 0.25) return 'low_stock';
  return 'in_stock';
}

export function toPublicInventory(doc: unknown): PublicInventory {
  const raw = doc as Record<string, unknown> & {
    _id?: unknown;
    product?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  };
  if (!raw) throw ApiError.notFound('Inventory not found');
  const totalMl = Number(raw.totalMl ?? 0);
  const remainingMl = Number(raw.remainingMl ?? 0);
  const threshold = Number(raw.lowStockThresholdMl ?? 30);

  return {
    id: raw._id ? String(raw._id) : '',
    product: pickPopulatedProduct(raw.product),
    productName: String(raw.productName ?? ''),
    bottleSize: (raw.bottleSize as PublicInventory['bottleSize']) ?? '30ml',
    totalMl,
    reservedBufferMl: Number(raw.reservedBufferMl ?? 0),
    remainingMl,
    purchaseCost: Number(raw.purchaseCost ?? 0),
    lowStockThresholdMl: threshold,
    status: computeStatus(remainingMl, totalMl, threshold),
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

/**
 * Look up the parent Product's name for the `productName` snapshot. Returns
 * an empty string if the parent doesn't exist (caller decides whether that's
 * an error — for create it is; for writeLog it's a noop).
 */
async function fetchProductName(productId: string): Promise<string> {
  const p = await Product.findById(productId).select('name').lean().exec();
  return p ? String((p as Record<string, unknown>).name ?? '') : '';
}

// ----- CRUD -----

export async function listInventory(
  queryStr: Record<string, unknown>
): Promise<PagedResult<PublicInventory>> {
  const { filter, sort, skip, limit, page } = buildMongooseQuery<IInventory>(
    queryStr,
    INVENTORY_QUERY_CONFIG
  );

  const [raw, total] = await Promise.all([
    Inventory.find(filter)
      .populate('product', 'name slug images')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    Inventory.countDocuments(filter).exec(),
  ]);

  const results = raw.map((d) => {
    const doc = d as unknown as Record<string, unknown>;
    if (doc._id && doc.id === undefined) doc.id = String(doc._id);
    delete doc._id;
    delete doc.__v;
    return toPublicInventory(doc);
  });

  return {
    results,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

export async function getInventoryById(id: string): Promise<PublicInventory> {
  const doc = await Inventory.findById(id).populate('product', 'name slug images');
  if (!doc) throw ApiError.notFound('Inventory not found');
  return toPublicInventory(doc);
}

export interface CreateInventoryInput {
  product: string;
  bottleSize: '3ml' | '5ml' | '10ml' | '30ml';
  totalMl: number;
  reservedBufferMl?: number;
  remainingMl: number;
  purchaseCost: number;
  lowStockThresholdMl?: number;
  /** Admin user id — written into the 'add' log row. */
  actorId?: string;
}

/**
 * Create a new inventory batch and write an 'add' log entry.
 * If `reservedBufferMl` is omitted, fall back to Settings.defaultReservedBufferMl.
 *
 * Duplicate (product, bottleSize) pairs are rejected via the compound unique
 * index — Mongo throws a duplicate-key error which we map to a 400.
 */
export async function createInventory(
  input: CreateInventoryInput
): Promise<PublicInventory> {
  const productName = await fetchProductName(input.product);
  if (!productName) {
    throw ApiError.badRequest('Referenced product does not exist');
  }

  const settings = await getSettings();
  const reservedBufferMl =
    input.reservedBufferMl ?? settings.defaultReservedBufferMl ?? 0;
  const lowStockThresholdMl =
    input.lowStockThresholdMl ?? settings.lowStockDefaultMl ?? 30;

  let doc;
  try {
    doc = await Inventory.create({
      product: input.product,
      productName,
      bottleSize: input.bottleSize,
      totalMl: input.totalMl,
      reservedBufferMl,
      remainingMl: input.remainingMl,
      purchaseCost: input.purchaseCost,
      lowStockThresholdMl,
    });
  } catch (err: unknown) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.badRequest(
        `An inventory batch for this product at ${input.bottleSize} already exists. Adjust the existing batch instead.`
      );
    }
    throw err;
  }

  await writeLog({
    inventory: String((doc as InventoryDoc)._id),
    product: input.product,
    type: 'add',
    quantityMl: input.remainingMl,
    note: 'Initial batch',
    createdBy: input.actorId,
  });

  const populated = await Inventory.findById(doc._id).populate(
    'product',
    'name slug images'
  );
  return toPublicInventory(populated);
}

const WRITABLE_INVENTORY_KEYS = [
  'purchaseCost',
  'lowStockThresholdMl',
  'reservedBufferMl',
] as const;

export async function updateInventory(
  id: string,
  input: Partial<IInventory>
): Promise<PublicInventory> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_INVENTORY_KEYS
  );
  if (Object.keys(set).length === 0) {
    return getInventoryById(id);
  }
  const doc = await Inventory.findByIdAndUpdate(
    id,
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Inventory not found');
  const populated = await Inventory.findById(id).populate(
    'product',
    'name slug images'
  );
  return toPublicInventory(populated);
}

export async function deleteInventory(id: string): Promise<PublicInventory> {
  // Hard delete: the inventory row records stock that no longer exists.
  // Inventory LOGS are never deleted (audit trail).
  const doc = await Inventory.findByIdAndDelete(id);
  if (!doc) throw ApiError.notFound('Inventory not found');
  return toPublicInventory(doc);
}

// ----- Atomic decrements -----

interface DecrementArgs {
  inventoryId: string;
  ml: number;
  type: 'sale' | 'adjustment' | 'bufferRelease';
  note?: string;
  referenceId?: string;
  actorId?: string;
  session?: ClientSession;
}

/**
 * Single atomic conditional decrement primitive. Used by sale / adjust /
 * release-buffer. Each call writes exactly one log row.
 *
 * - For 'sale' / 'adjustment': decrements `remainingMl`. Total ml stays put.
 * - For 'bufferRelease':     decrements `reservedBufferMl` AND increments
 *                             `remainingMl` by the same ml (free reserved
 *                             capacity back into the sellable pool).
 *
 * The Mongo conditional `{ field: { $gte: ml } }` is the race-condition
 * guard: if another concurrent caller has already drained the field below
 * `ml`, the update matches zero rows and we throw a 400 — no negative
 * stock is ever persisted.
 */
async function atomicDecrement({
  inventoryId,
  ml,
  type,
  note,
  referenceId,
  actorId,
  session,
}: DecrementArgs): Promise<PublicInventory> {
  if (ml <= 0) {
    throw ApiError.badRequest('Quantity must be positive');
  }

  let updated;
  if (type === 'bufferRelease') {
    // Two-step atomic update: decrement reservedBufferMl AND increment
    // remainingMl. Mongoose findOneAndUpdate supports a single $inc op
    // covering both, with the conditional still on reservedBufferMl.
    updated = await Inventory.findOneAndUpdate(
      { _id: inventoryId, reservedBufferMl: { $gte: ml } },
      { $inc: { reservedBufferMl: -ml, remainingMl: ml } },
      { new: true, runValidators: true, session }
    );
  } else {
    updated = await Inventory.findOneAndUpdate(
      { _id: inventoryId, remainingMl: { $gte: ml } },
      { $inc: { remainingMl: -ml } },
      { new: true, runValidators: true, session }
    );
  }

  if (!updated) {
    const field = type === 'bufferRelease' ? 'reserved buffer' : 'stock';
    throw ApiError.badRequest(
      `Insufficient ${field} to complete this operation`
    );
  }

  await writeLog(
    {
      inventory: inventoryId,
      product: String((updated as InventoryDoc).product),
      type,
      quantityMl: ml,
      note: note ?? '',
      referenceId,
      createdBy: actorId,
    },
    session
  );

  const populated = await Inventory.findById(inventoryId).populate(
    'product',
    'name slug images'
  );
  return toPublicInventory(populated);
}

export async function adjustInventoryMl(
  inventoryId: string,
  deltaMl: number,
  note: string,
  actorId?: string
): Promise<PublicInventory> {
  // Negative deltas go through the atomic decrement path. Positive deltas
  // are a plain $inc — no race-condition risk on the upside.
  if (deltaMl < 0) {
    return atomicDecrement({
      inventoryId,
      ml: Math.abs(deltaMl),
      type: 'adjustment',
      note,
      actorId,
    });
  }
  if (deltaMl === 0) {
    return getInventoryById(inventoryId);
  }
  // Positive adjustment: bump remainingMl and totalMl together so the
  // computed `status` reflects the new capacity.
  const updated = await Inventory.findByIdAndUpdate(
    inventoryId,
    { $inc: { remainingMl: deltaMl, totalMl: deltaMl } },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.notFound('Inventory not found');

  await writeLog({
    inventory: inventoryId,
    product: String((updated as InventoryDoc).product),
    type: 'adjustment',
    quantityMl: deltaMl,
    note,
    createdBy: actorId,
  });

  const populated = await Inventory.findById(inventoryId).populate(
    'product',
    'name slug images'
  );
  return toPublicInventory(populated);
}

export async function releaseBufferMl(
  inventoryId: string,
  quantityMl: number,
  note: string,
  actorId?: string
): Promise<PublicInventory> {
  return atomicDecrement({
    inventoryId,
    ml: quantityMl,
    type: 'bufferRelease',
    note,
    actorId,
  });
}

export async function recordSaleMl(
  inventoryId: string,
  quantityMl: number,
  referenceId: string | undefined,
  note: string,
  actorId?: string
): Promise<PublicInventory> {
  return atomicDecrement({
    inventoryId,
    ml: quantityMl,
    type: 'sale',
    note,
    referenceId,
    actorId,
  });
}

// ----- Helpers -----

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 11000
  );
}
