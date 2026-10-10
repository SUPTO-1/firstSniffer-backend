import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';
import type { ProductSize } from '../_shared/validation';

export interface IInventory {
  /** Reference to the parent product (soft-delete-aware). */
  product: Types.ObjectId;
  /**
   * Snapshot of the product name at write time. Kept in sync by a hook on
   * Product.save / findOneAndUpdate so the inventory search bar can match
   * by product name without an extra populate + $lookup.
   */
  productName: string;
  /** Fixed bottle size — see PRODUCT_SIZES. */
  bottleSize: ProductSize;
  /** Total ml capacity of this batch (e.g. 30000 for a 30ml bottle × 1000 units). */
  totalMl: number;
  /** Currently reserved ml (held for pending orders). Counts toward "in stock" but isn't sellable. */
  reservedBufferMl: number;
  /** Free ml available for new orders. Never negative (atomic guard on every decrement). */
  remainingMl: number;
  /** Cost paid to acquire this batch — used in dashboard COGS calculations. */
  purchaseCost: number;
  /** When remainingMl ≤ this value, status becomes 'low_stock'. */
  lowStockThresholdMl: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type InventoryDoc = IInventory & Document & { _id: unknown };

/** Status is computed at read time (no persistence). */
export type InventoryStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

/** Minimal product shape carried with each inventory row. */
export interface PublicInventoryProductRef {
  id: string;
  name: string;
  slug: string;
  images: { url: string; fileId: string; alt?: string }[];
}

/** Public-facing shape returned to the frontend. */
export interface PublicInventory {
  id: string;
  product: PublicInventoryProductRef | null;
  productName: string;
  bottleSize: ProductSize;
  totalMl: number;
  reservedBufferMl: number;
  remainingMl: number;
  purchaseCost: number;
  lowStockThresholdMl: number;
  /** Computed from remainingMl vs totalMl and lowStockThresholdMl. */
  status: InventoryStatus;
  createdAt?: string;
  updatedAt?: string;
}

export const INVENTORY_QUERY_CONFIG: QueryConfig = {
  // `productName` is the searchable denormalised snapshot.
  searchFields: ['productName'],
  allowedFilters: {
    product: 'objectId',
    bottleSize: 'enum:3ml,5ml,10ml,30ml',
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
