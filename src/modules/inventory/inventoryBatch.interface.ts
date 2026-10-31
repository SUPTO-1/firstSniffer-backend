import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

/**
 * InventoryBatch — one *purchase* of original bottles for a product.
 *
 * The decant business works like this: the seller buys a 100ml original
 * bottle and sells 3/5/10/15/30ml decants from it. Every selling size of a
 * product draws from the SAME physical pool, so a batch describes ownership
 * (what we bought), while `Product.variants` describes what we sell.
 *
 * All millilitre fields are TRUE millilitres. `totalMl` is always derived
 * as `sourceBottleSizeMl * quantity` by the service layer — the API never
 * accepts it as an input, so a batch can never carry an inconsistent pair.
 */
export interface IInventoryBatch {
  /** The product this batch belongs to. All selling sizes share its pool. */
  product: Types.ObjectId;
  /** Denormalised product-name snapshot, synced by a hook on Product. */
  productName: string;

  /** Capacity of ONE original bottle, in ml. Numeric — 100, 50, 30, 7… */
  sourceBottleSizeMl: number;
  /** How many original bottles this batch contains. */
  quantity: number;
  /** Total capacity = sourceBottleSizeMl * quantity. Derived, never client-set. */
  totalMl: number;
  /** Sellable liquid left in this batch. Never negative. */
  remainingMl: number;
  /** TOTAL cost paid for this batch (not per bottle, not per ml). */
  purchaseCost: number;
  /** When the bottles were bought — drives FIFO consumption order. */
  purchaseDate: Date;
  supplier: string;
  notes: string;
  /** False = fully consumed / retired. Retired batches keep their history. */
  isActive: boolean;
  /**
   * Set when this batch was created by migrating a legacy `Inventory` row.
   * Keeps the old→new mapping traceable and the migration reversible.
   */
  migratedFrom?: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export type InventoryBatchDoc = IInventoryBatch & Document & { _id: unknown };

/**
 * Product-level stock summary, derived from the product's batches.
 * `sellableMl` is what a customer can actually buy: physical remaining minus
 * the product's safety buffer.
 */
export interface ProductStock {
  productId: string;
  productName: string;
  /** Sum of every active batch's capacity. */
  totalMl: number;
  /** Sum of every active batch's remaining ml. */
  remainingMl: number;
  /** Seller-held margin that is never sellable. */
  safetyBufferMl: number;
  /** remainingMl - safetyBufferMl, floored at 0. */
  sellableMl: number;
  /** Warn when sellableMl <= this. */
  lowStockThresholdMl: number;
  /** Number of active batches backing this product. */
  batchCount: number;
  status: InventoryStatus;
}

export type InventoryStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

/** A single debit against a specific batch. */
export interface StockAllocation {
  batch: string;
  millilitres: number;
}

/** Minimal product shape carried with each batch row. */
export interface PublicInventoryProductRef {
  id: string;
  name: string;
  slug: string;
  images: { url: string; fileId: string; alt?: string }[];
}

export interface PublicInventoryBatch {
  id: string;
  product: PublicInventoryProductRef | null;
  productName: string;
  sourceBottleSizeMl: number;
  quantity: number;
  totalMl: number;
  remainingMl: number;
  purchaseCost: number;
  purchaseDate: string;
  supplier: string;
  notes: string;
  isActive: boolean;
  /** Cost per ml across the whole batch — derived for dashboard reporting. */
  costPerMl: number;
  createdAt?: string;
  updatedAt?: string;
}

export const INVENTORY_BATCH_QUERY_CONFIG: QueryConfig = {
  // `productName` is the searchable denormalised snapshot.
  searchFields: ['productName', 'supplier'],
  allowedFilters: {
    product: 'objectId',
    isActive: 'boolean',
  },
  defaultSort: '-purchaseDate',
  maxLimit: 100,
};
