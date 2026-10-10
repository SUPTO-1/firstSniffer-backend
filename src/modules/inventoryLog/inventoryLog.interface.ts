import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export type InventoryLogType = 'add' | 'sale' | 'bufferRelease' | 'adjustment';

export interface IInventoryLog {
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
    type: 'enum:add,sale,bufferRelease,adjustment',
    product: 'objectId',
    inventory: 'objectId',
    createdBy: 'objectId',
  },
  defaultSort: '-createdAt',
  maxLimit: 200,
};
