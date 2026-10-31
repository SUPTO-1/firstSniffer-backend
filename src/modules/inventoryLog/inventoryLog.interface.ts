import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

/**
 * InventoryLogType — the kind of stock movement.
 *
 *  - `add`       : a new purchase batch was created.
 *  - `sale`      : ml consumed by an order. Recorded per BATCH, so an order
 *                  line that drew from three bottles leaves three rows.
 *  - `reversal`  : ml returned to a batch when an order is cancelled/returned.
 *                  Always targets the same batch the sale came from.
 *  - `adjustment`: manual correction (spillage, audit).
 *  - `restock`   : liquid added to an existing batch.
 *  - `retire`    : a fully-consumed batch was retired (zero ml moved).
 */
export type InventoryLogType =
  | 'add'
  | 'sale'
  | 'reversal'
  | 'adjustment'
  | 'restock'
  | 'retire';

export interface IInventoryLog {
  /**
   * The batch this movement belongs to.
   *
   * The field keeps its historical name (`inventory`) so the existing rows
   * and indexes stay valid, but its `ref` now points at `InventoryBatch` —
   * the log is batch-level, which is what makes multi-batch orders
   * auditable.
   */
  inventory: Types.ObjectId;
  product: Types.ObjectId;
  type: InventoryLogType;
  /** Always a positive integer — the magnitude of the change. Sign is implicit in `type`. */
  quantityMl: number;
  /** Optional external id (e.g. order id from the future Orders module). */
  referenceId?: string;
  note?: string;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type InventoryLogDoc = IInventoryLog & Document & { _id: unknown };

/** Minimal user shape returned in the public log row (createdBy). */
export interface PublicInventoryLogUserRef {
  id: string;
  name: string;
  email: string;
}

export interface PublicInventoryLog {
  id: string;
  inventory: string;
  product: { id: string; name: string; slug: string } | null;
  type: InventoryLogType;
  quantityMl: number;
  referenceId: string | null;
  note: string;
  createdBy: PublicInventoryLogUserRef | null;
  createdAt?: string;
  updatedAt?: string;
}

export const INVENTORY_LOG_QUERY_CONFIG: QueryConfig = {
  // No search text — audit logs are filtered, not searched.
  searchFields: [],
  allowedFilters: {
    type: 'enum:add,sale,reversal,adjustment,restock,retire',
    product: 'objectId',
    inventory: 'objectId',
    createdBy: 'objectId',
  },
  defaultSort: '-createdAt',
  maxLimit: 200,
};
