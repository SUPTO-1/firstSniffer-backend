import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { InventoryBatch } from './inventoryBatch.model';
import { Product } from '../product/product.model';
import { ApiError } from '../../utils/ApiError';
import {
  buildMongooseQuery,
  type PagedResult,
} from '../../utils/queryBuilder';
import { writeLog } from '../inventoryLog/inventoryLog.service';
import { pickWritable } from '../_shared/pickWritable';
import type {
  IInventoryBatch,
  InventoryBatchDoc,
  InventoryStatus,
  ProductStock,
  PublicInventoryBatch,
  PublicInventoryProductRef,
  StockAllocation,
} from './inventoryBatch.interface';
import { INVENTORY_BATCH_QUERY_CONFIG } from './inventoryBatch.interface';

/* ------------------------------------------------------------------
 *  Mapping helpers
 * ------------------------------------------------------------------ */

/**
 * Cast product ids to ObjectId for use inside an AGGREGATION pipeline.
 *
 * Mongoose casts `find()` filters automatically, but `aggregate()` does
 * NOT — a `$match: { product: '<24-hex string>' }` compares a string against
 * stored ObjectIds and matches nothing, which silently reads as "no stock".
 * Every `$match` on a product id must go through here.
 */
function toObjectIds(ids: string[]): Types.ObjectId[] {
  return ids
    .map((id) => {
      try {
        return new Types.ObjectId(id);
      } catch {
        return null;
      }
    })
    .filter((id): id is Types.ObjectId => id !== null);
}

/** A single product id as an ObjectId, or `null` when it is not a valid id. */
function toObjectId(id: string): Types.ObjectId | null {
  try {
    return new Types.ObjectId(id);
  } catch {
    return null;
  }
}

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
 * `status` is computed at read time from the product's SELLABLE ml.
 *
 * Unlike the old per-row heuristic (`remainingMl < totalMl * 0.25`), this is
 * a product-level absolute measurement — the 25%-of-capacity rule breaks as
 * soon as a product has more than one batch with different fill levels, and
 * it has no meaning at all once a safety buffer is subtracted.
 */
export function computeStockStatus(
  sellableMl: number,
  lowStockThresholdMl: number
): InventoryStatus {
  if (sellableMl <= 0) return 'out_of_stock';
  if (sellableMl <= lowStockThresholdMl) return 'low_stock';
  return 'in_stock';
}

export function toPublicInventoryBatch(doc: unknown): PublicInventoryBatch {
  const raw = doc as Record<string, unknown> & {
    _id?: unknown;
    product?: unknown;
    purchaseDate?: Date;
    createdAt?: Date;
    updatedAt?: Date;
  };
  if (!raw) throw ApiError.notFound('Inventory batch not found');

  const totalMl = Number(raw.totalMl ?? 0);
  const purchaseCost = Number(raw.purchaseCost ?? 0);

  return {
    id: raw._id ? String(raw._id) : '',
    product: pickPopulatedProduct(raw.product),
    productName: String(raw.productName ?? ''),
    sourceBottleSizeMl: Number(raw.sourceBottleSizeMl ?? 0),
    quantity: Number(raw.quantity ?? 0),
    totalMl,
    remainingMl: Number(raw.remainingMl ?? 0),
    purchaseCost,
    purchaseDate: raw.purchaseDate?.toISOString?.() ?? '',
    supplier: String(raw.supplier ?? ''),
    notes: String(raw.notes ?? ''),
    isActive: raw.isActive !== false,
    costPerMl: totalMl > 0 ? Math.round((purchaseCost / totalMl) * 100) / 100 : 0,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

/**
 * Look up the parent Product's name for the `productName` snapshot.
 * Returns an empty string if the parent doesn't exist.
 */
async function fetchProductName(productId: string): Promise<string> {
  const p = await Product.findById(productId).select('name').lean().exec();
  return p ? String((p as Record<string, unknown>).name ?? '') : '';
}

/* ------------------------------------------------------------------
 *  Product-level stock aggregation
 * ------------------------------------------------------------------ */

/**
 * Product-level stock summary for one product, derived live from its
 * batches. This is the SINGLE source of truth for "how much can I sell" —
 * there is no summary collection to drift out of sync.
 *
 *   totalMl   = Σ active batches' totalMl
 *   remaining = Σ active batches' remainingMl
 *   sellable  = remaining − product.safetyBufferMl
 *
 * The safety buffer is a seller-owned margin that is genuinely ENFORCED here
 * (the old `reservedBufferMl` was stored but never subtracted anywhere).
 */
export async function getProductStock(
  productId: string
): Promise<ProductStock> {
  const product = await Product.findById(productId)
    .select('name safetyBufferMl lowStockThresholdMl')
    .lean()
    .exec();

  const productObjectId = toObjectId(productId);

  const rows = await InventoryBatch.aggregate<{
    _id: null;
    totalMl: number;
    remainingMl: number;
    batchCount: number;
  }>([
    {
      $match: {
        product: productObjectId ?? new Types.ObjectId('000000000000000000000000'),
        isActive: true,
      },
    },
    {
      $group: {
        _id: null,
        totalMl: { $sum: '$totalMl' },
        remainingMl: { $sum: '$remainingMl' },
        batchCount: { $sum: 1 },
      },
    },
  ]).exec();

  const agg = rows[0];
  const totalMl = agg?.totalMl ?? 0;
  const remainingMl = agg?.remainingMl ?? 0;
  const safetyBufferMl = Math.max(
    0,
    Number((product as { safetyBufferMl?: number } | null)?.safetyBufferMl ?? 0)
  );
  const lowStockThresholdMl = Math.max(
    0,
    Number((product as { lowStockThresholdMl?: number } | null)?.lowStockThresholdMl ?? 30)
  );
  const sellableMl = Math.max(0, remainingMl - safetyBufferMl);

  return {
    productId,
    productName: String((product as { name?: string } | null)?.name ?? ''),
    totalMl,
    remainingMl,
    safetyBufferMl,
    sellableMl,
    lowStockThresholdMl,
    batchCount: agg?.batchCount ?? 0,
    status: computeStockStatus(sellableMl, lowStockThresholdMl),
  };
}

/**
 * Product-level stock for many products at once — one aggregation instead of
 * N round-trips. Used by the admin product-level inventory list and the
 * storefront's `?inStock=true` filter.
 */
export async function getProductStockForProducts(
  productIds: string[]
): Promise<Map<string, ProductStock>> {
  const out = new Map<string, ProductStock>();
  if (productIds.length === 0) return out;

  const products = await Product.find({ _id: { $in: productIds } })
    .select('name safetyBufferMl lowStockThresholdMl')
    .lean()
    .exec();

  const rows = await InventoryBatch.aggregate<{
    _id: string;
    totalMl: number;
    remainingMl: number;
    batchCount: number;
  }>([
    { $match: { product: { $in: toObjectIds(productIds) }, isActive: true } },
    {
      $group: {
        _id: '$product',
        totalMl: { $sum: '$totalMl' },
        remainingMl: { $sum: '$remainingMl' },
        batchCount: { $sum: 1 },
      },
    },
  ]).exec();

  const aggByProduct = new Map(rows.map((r) => [String(r._id), r]));
  const productById = new Map(
    products.map((p) => [
      String(p._id),
      p as unknown as {
        name?: string;
        safetyBufferMl?: number;
        lowStockThresholdMl?: number;
      },
    ])
  );

  for (const id of productIds) {
    const agg = aggByProduct.get(id);
    const product = productById.get(id);
    const totalMl = agg?.totalMl ?? 0;
    const remainingMl = agg?.remainingMl ?? 0;
    const safetyBufferMl = Math.max(0, Number(product?.safetyBufferMl ?? 0));
    const lowStockThresholdMl = Math.max(
      0,
      Number(product?.lowStockThresholdMl ?? 30)
    );
    const sellableMl = Math.max(0, remainingMl - safetyBufferMl);
    out.set(id, {
      productId: id,
      productName: String(product?.name ?? ''),
      totalMl,
      remainingMl,
      safetyBufferMl,
      sellableMl,
      lowStockThresholdMl,
      batchCount: agg?.batchCount ?? 0,
      status: computeStockStatus(sellableMl, lowStockThresholdMl),
    });
  }
  return out;
}

/* ------------------------------------------------------------------
 *  CRUD
 * ------------------------------------------------------------------ */

export async function listInventoryBatches(
  queryStr: Record<string, unknown>
): Promise<PagedResult<PublicInventoryBatch>> {
  const { filter, sort, skip, limit, page } = buildMongooseQuery<IInventoryBatch>(
    queryStr,
    INVENTORY_BATCH_QUERY_CONFIG
  );

  const [raw, total] = await Promise.all([
    InventoryBatch.find(filter)
      .populate('product', 'name slug images')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    InventoryBatch.countDocuments(filter).exec(),
  ]);

  const results = raw.map((d) => {
    const doc = d as unknown as Record<string, unknown>;
    if (doc._id && doc.id === undefined) doc.id = String(doc._id);
    delete doc._id;
    delete doc.__v;
    return toPublicInventoryBatch(doc);
  });

  return {
    results,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

export async function getInventoryBatchById(
  id: string
): Promise<PublicInventoryBatch> {
  const doc = await InventoryBatch.findById(id).populate(
    'product',
    'name slug images'
  );
  if (!doc) throw ApiError.notFound('Inventory batch not found');
  return toPublicInventoryBatch(doc);
}

export interface CreateInventoryBatchInput {
  product: string;
  sourceBottleSizeMl: number;
  quantity: number;
  purchaseCost: number;
  purchaseDate?: Date | string;
  supplier?: string;
  notes?: string;
  /** Admin user id — written into the 'add' log row. */
  actorId?: string;
}

/**
 * Create a purchase batch.
 *
 * `totalMl` and `remainingMl` are DERIVED here (`sourceBottleSizeMl *
 * quantity`) — the API never accepts them, so a batch can never hold an
 * inconsistent capacity/remmaining pair.
 */
export async function createInventoryBatch(
  input: CreateInventoryBatchInput
): Promise<PublicInventoryBatch> {
  const productName = await fetchProductName(input.product);
  if (!productName) {
    throw ApiError.badRequest('Referenced product does not exist');
  }

  const sourceBottleSizeMl = Math.round(Number(input.sourceBottleSizeMl));
  const quantity = Math.round(Number(input.quantity));
  if (!Number.isFinite(sourceBottleSizeMl) || sourceBottleSizeMl < 1) {
    throw ApiError.badRequest('Original bottle size must be at least 1 ml');
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw ApiError.badRequest('Number of bottles must be at least 1');
  }

  const totalMl = sourceBottleSizeMl * quantity;

  const purchaseDate =
    input.purchaseDate instanceof Date
      ? input.purchaseDate
      : input.purchaseDate
        ? new Date(input.purchaseDate)
        : new Date();
  if (Number.isNaN(purchaseDate.getTime())) {
    throw ApiError.badRequest('Purchase date is invalid');
  }

  const doc = await InventoryBatch.create({
    product: input.product,
    productName,
    sourceBottleSizeMl,
    quantity,
    totalMl,
    remainingMl: totalMl,
    purchaseCost: Math.max(0, Math.round(Number(input.purchaseCost) || 0)),
    purchaseDate,
    supplier: input.supplier?.trim() ?? '',
    notes: input.notes?.trim() ?? '',
    isActive: true,
  });

  await writeLog({
    inventory: String((doc as InventoryBatchDoc)._id),
    product: input.product,
    type: 'add',
    quantityMl: totalMl,
    note: `Purchase — ${quantity} × ${sourceBottleSizeMl}ml bottle(s)`,
    createdBy: input.actorId,
  });

  const populated = await InventoryBatch.findById(doc._id).populate(
    'product',
    'name slug images'
  );
  return toPublicInventoryBatch(populated);
}

const WRITABLE_BATCH_KEYS = [
  'purchaseCost',
  'purchaseDate',
  'supplier',
  'notes',
] as const;

export async function updateInventoryBatch(
  id: string,
  input: Partial<IInventoryBatch>
): Promise<PublicInventoryBatch> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_BATCH_KEYS
  );
  if (Object.keys(set).length === 0) {
    return getInventoryBatchById(id);
  }
  if (set.purchaseDate !== undefined) {
    const d = new Date(String(set.purchaseDate));
    if (Number.isNaN(d.getTime())) {
      throw ApiError.badRequest('Purchase date is invalid');
    }
    set.purchaseDate = d;
  }
  const doc = await InventoryBatch.findByIdAndUpdate(
    id,
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Inventory batch not found');
  const populated = await InventoryBatch.findById(id).populate(
    'product',
    'name slug images'
  );
  return toPublicInventoryBatch(populated);
}

/**
 * Retire a batch. Soft-delete by design — the movement history and the
 * order allocations that reference it must stay intact, so a consumed batch
 * is never hard-deleted.
 */
export async function retireInventoryBatch(
  id: string,
  actorId?: string
): Promise<PublicInventoryBatch> {
  const existing = await InventoryBatch.findById(id).lean().exec();
  if (!existing) throw ApiError.notFound('Inventory batch not found');

  const remaining = Number((existing as { remainingMl?: number }).remainingMl ?? 0);
  if (remaining > 0) {
    throw ApiError.badRequest(
      `This batch still has ${remaining}ml remaining. Adjust it to 0 before retiring.`
    );
  }

  const doc = await InventoryBatch.findByIdAndUpdate(
    id,
    { $set: { isActive: false } },
    { new: true }
  );
  if (!doc) throw ApiError.notFound('Inventory batch not found');

  await writeLog({
    inventory: id,
    product: String((existing as { product: unknown }).product),
    type: 'retire',
    quantityMl: 0,
    note: 'Batch retired',
    createdBy: actorId,
  });

  const populated = await InventoryBatch.findById(id).populate(
    'product',
    'name slug images'
  );
  return toPublicInventoryBatch(populated);
}

/* ------------------------------------------------------------------
 *  Movements — restock / adjust / reversal
 * ------------------------------------------------------------------ */

/**
 * Manual ml adjustment on a batch (spillage, audit correction).
 *
 * A NEGATIVE delta is a consumption: it uses the atomic guarded update so
 * concurrent callers can never drive `remainingMl` below zero.
 * A POSITIVE delta is a restock: it adds liquid to the batch and, because
 * this genuinely increases what the batch holds, bumps `totalMl` too.
 *
 * This is deliberately distinct from `restoreAllocations`, which reverses a
 * SALE and therefore must NOT touch `totalMl` — the original bottle's
 * capacity never changed, only how much of it is left.
 */
export async function adjustBatchMl(
  batchId: string,
  deltaMl: number,
  note: string,
  actorId?: string
): Promise<PublicInventoryBatch> {
  if (deltaMl === 0) return getInventoryBatchById(batchId);

  if (deltaMl < 0) {
    const ml = Math.abs(deltaMl);
    const updated = await InventoryBatch.findOneAndUpdate(
      { _id: batchId, remainingMl: { $gte: ml } },
      { $inc: { remainingMl: -ml } },
      { new: true, runValidators: true }
    );
    if (!updated) {
      throw ApiError.badRequest('Insufficient stock to complete this adjustment');
    }
    await writeLog({
      inventory: batchId,
      product: String((updated as InventoryBatchDoc).product),
      type: 'adjustment',
      quantityMl: ml,
      note,
      createdBy: actorId,
    });
    const populated = await InventoryBatch.findById(batchId).populate(
      'product',
      'name slug images'
    );
    return toPublicInventoryBatch(populated);
  }

  const updated = await InventoryBatch.findByIdAndUpdate(
    batchId,
    { $inc: { remainingMl: deltaMl, totalMl: deltaMl } },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.notFound('Inventory batch not found');

  await writeLog({
    inventory: batchId,
    product: String((updated as InventoryBatchDoc).product),
    type: 'restock',
    quantityMl: deltaMl,
    note,
    createdBy: actorId,
  });

  const populated = await InventoryBatch.findById(batchId).populate(
    'product',
    'name slug images'
  );
  return toPublicInventoryBatch(populated);
}

/**
 * Add liquid to an existing batch WITHOUT increasing its capacity — used
 * when the seller tops up a bottle that was already counted (e.g. replacing
 * a stopper, recovering spillage).
 *
 * Unlike `adjustBatchMl`'s positive branch this leaves `totalMl` alone.
 */
export async function restockBatchMl(
  batchId: string,
  ml: number,
  note: string,
  actorId?: string
): Promise<PublicInventoryBatch> {
  if (ml <= 0) throw ApiError.badRequest('Quantity must be positive');
  const updated = await InventoryBatch.findByIdAndUpdate(
    batchId,
    { $inc: { remainingMl: ml } },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.notFound('Inventory batch not found');

  await writeLog({
    inventory: batchId,
    product: String((updated as InventoryBatchDoc).product),
    type: 'restock',
    quantityMl: ml,
    note,
    createdBy: actorId,
  });

  const populated = await InventoryBatch.findById(batchId).populate(
    'product',
    'name slug images'
  );
  return toPublicInventoryBatch(populated);
}

/* ------------------------------------------------------------------
 *  FIFO consumption
 * ------------------------------------------------------------------ */

/**
 * Consume `ml` from a product's stock pool, oldest purchase first.
 *
 * The allocation may SPREAD across batches: a 30ml decant can be assembled
 * from 12ml left in one bottle and 18ml from another. That is physically
 * correct for a decant business — you fill the vial from whichever bottles
 * still have liquid.
 *
 * Each debit uses the atomic guarded update `{ remainingMl: { $gte: take } }`.
 * If a concurrent order drained the batch first, the update matches zero
 * documents and we re-plan from the new state (bounded retry). Negative
 * stock is therefore impossible.
 *
 * NOTE: no Mongo transactions are available — the deployment is a standalone
 * container. Guarded updates + bounded retry is the safety mechanism.
 */
export async function consumeFifo(
  productId: string,
  ml: number,
  opts: {
    referenceId?: string;
    note?: string;
    actorId?: string;
    session?: ClientSession;
  } = {}
): Promise<StockAllocation[]> {
  if (ml <= 0) throw ApiError.badRequest('Quantity must be positive');

  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const candidates = await InventoryBatch.find({
      product: productId,
      isActive: true,
      remainingMl: { $gt: 0 },
    })
      .sort({ purchaseDate: 1, _id: 1 })
      .select('_id remainingMl')
      .lean()
      .exec();

    let remainingToAllocate = ml;
    const plan: { batch: string; take: number }[] = [];

    for (const c of candidates) {
      if (remainingToAllocate <= 0) break;
      const available = Number(
        (c as { remainingMl?: number }).remainingMl ?? 0
      );
      if (available <= 0) continue;
      const take = Math.min(available, remainingToAllocate);
      plan.push({ batch: String((c as { _id: unknown })._id), take });
      remainingToAllocate -= take;
    }

    if (remainingToAllocate > 0) {
      // Not enough liquid across all active batches.
      throw ApiError.badRequest('Insufficient stock');
    }

    // Apply the plan with guarded atomic decrements.
    const applied: StockAllocation[] = [];
    let conflict = false;

    for (const step of plan) {
      const updated = await InventoryBatch.findOneAndUpdate(
        { _id: step.batch, remainingMl: { $gte: step.take } },
        { $inc: { remainingMl: -step.take } },
        { new: true, runValidators: true, session: opts.session }
      );
      if (!updated) {
        // Another order consumed from this batch between our read and write.
        conflict = true;
        break;
      }
      applied.push({ batch: step.batch, millilitres: step.take });
    }

    if (!conflict) {
      // Log one row per batch touched — the log is batch-level, so a line
      // that drew from three bottles leaves three traceable entries.
      for (const a of applied) {
        const batchDoc = await InventoryBatch.findById(a.batch)
          .select('product')
          .lean()
          .exec();
        await writeLog(
          {
            inventory: a.batch,
            product: String((batchDoc as { product?: unknown } | null)?.product ?? productId),
            type: 'sale',
            quantityMl: a.millilitres,
            note: opts.note ?? '',
            referenceId: opts.referenceId,
            createdBy: opts.actorId,
          },
          opts.session
        );
      }
      return applied;
    }

    // Conflict: roll back what this attempt already debited, then re-plan.
    for (const a of applied) {
      await InventoryBatch.findOneAndUpdate(
        { _id: a.batch },
        { $inc: { remainingMl: a.millilitres } },
        { new: true, session: opts.session }
      );
    }
  }

  throw ApiError.badRequest(
    'Could not allocate stock — the pool changed while ordering. Please retry.'
  );
}

/**
 * Restore stock that was previously consumed, into the EXACT batches it came
 * from.
 *
 * This is why `stockAllocations` is persisted on the order item: a
 * multi-batch order must be reversed into the same bottles it drew from,
 * not into an arbitrary batch of the same product.
 *
 * `totalMl` is NOT touched — reversing a sale restores how much liquid is
 * left, not how much the bottle holds.
 */
export async function restoreAllocations(
  allocations: StockAllocation[],
  opts: {
    referenceId?: string;
    note?: string;
    actorId?: string;
    session?: ClientSession;
  } = {}
): Promise<void> {
  for (const a of allocations) {
    const ml = Number(a.millilitres);
    if (!Number.isFinite(ml) || ml <= 0) continue;

    const updated = await InventoryBatch.findByIdAndUpdate(
      { _id: a.batch },
      { $inc: { remainingMl: ml } },
      { new: true, runValidators: true, session: opts.session }
    );
    if (!updated) continue; // batch was deleted — nothing to restore into

    await writeLog(
      {
        inventory: a.batch,
        product: String((updated as InventoryBatchDoc).product),
        type: 'reversal',
        quantityMl: ml,
        note: opts.note ?? '',
        referenceId: opts.referenceId,
        createdBy: opts.actorId,
      },
      opts.session
    );
  }
}

/**
 * Best-effort compensation used when an order fails halfway through
 * creation. Restores what was consumed, into the same batches.
 */
export async function rollbackConsumption(
  allocations: StockAllocation[],
  opts: { referenceId?: string; note?: string; actorId?: string } = {}
): Promise<void> {
  try {
    await restoreAllocations(allocations, {
      ...opts,
      note: opts.note ?? 'Order creation failed — stock restored',
    });
  } catch {
    // Best-effort. A failed rollback is logged by the caller's error path.
  }
}
