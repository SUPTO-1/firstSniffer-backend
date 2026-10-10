import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export type CouponType = 'fixed' | 'percentage';

export interface ICoupon {
  code: string;
  type: CouponType;
  /** For `fixed`: ৳ amount. For `percentage`: percent (0-100). */
  value: number;
  minPurchase: number;
  /** Only meaningful when `type === 'percentage'`. */
  maxDiscount?: number | null;
  expiresAt?: Date | null;
  usageLimit: number;
  usedCount: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type CouponDoc = ICoupon & Document & { _id: unknown };

export interface PublicCoupon {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minPurchase: number;
  maxDiscount?: number | null;
  expiresAt?: string | null;
  usageLimit: number;
  usedCount: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CouponValidation {
  valid: boolean;
  reason?: string;
  discount?: number;
  code?: string;
}

export const COUPON_QUERY_CONFIG: QueryConfig = {
  searchFields: ['code'],
  allowedFilters: {
    isActive: 'boolean',
    type: 'enum:fixed,percentage',
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};