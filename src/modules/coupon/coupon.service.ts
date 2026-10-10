import { ApiError } from '../../utils/ApiError';
import { Coupon } from './coupon.model';
import { pickWritable } from '../_shared/pickWritable';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import {
  COUPON_QUERY_CONFIG,
  type CouponDoc,
  type CouponValidation,
  type ICoupon,
  type PublicCoupon,
} from './coupon.interface';

const WRITABLE_COUPON_KEYS = [
  'code',
  'type',
  'value',
  'minPurchase',
  'maxDiscount',
  'expiresAt',
  'usageLimit',
  'isActive',
] as const;

export function toPublicCoupon(doc: CouponDoc | null): PublicCoupon {
  if (!doc) throw ApiError.notFound('Coupon not found');
  const raw = doc as unknown as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: raw._id ? String(raw._id) : '',
    code: ((raw.code as string) ?? '').toUpperCase(),
    type: raw.type as PublicCoupon['type'],
    value: (raw.value as number) ?? 0,
    minPurchase: (raw.minPurchase as number) ?? 0,
    maxDiscount: (raw.maxDiscount as number | null) ?? null,
    expiresAt: raw.expiresAt
      ? new Date(raw.expiresAt as Date | string).toISOString()
      : null,
    usageLimit: (raw.usageLimit as number) ?? 1,
    usedCount: (raw.usedCount as number) ?? 0,
    isActive: raw.isActive !== false,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

export async function createCoupon(input: Partial<ICoupon>): Promise<PublicCoupon> {
  const doc = await Coupon.create({
    ...input,
    code: (input.code ?? '').toUpperCase(),
  });
  return toPublicCoupon(doc);
}

export function listCoupons(
  queryStr: Record<string, unknown>
): Promise<PagedResult<ICoupon>> {
  return executePagedQuery<ICoupon>(
    Coupon as unknown as import('mongoose').Model<ICoupon>,
    queryStr,
    COUPON_QUERY_CONFIG
  );
}

export async function getCouponById(id: string): Promise<PublicCoupon> {
  const doc = await Coupon.findById(id);
  return toPublicCoupon(doc);
}

export async function updateCoupon(
  id: string,
  input: Partial<ICoupon>
): Promise<PublicCoupon> {
  const set = pickWritable(
    { ...input, code: (input.code ?? '').toUpperCase() || input.code } as Record<string, unknown>,
    WRITABLE_COUPON_KEYS
  );
  const doc = await Coupon.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Coupon not found');
  return toPublicCoupon(doc);
}

export async function deleteCoupon(id: string): Promise<PublicCoupon> {
  const doc = await Coupon.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Coupon not found');
  return toPublicCoupon(doc);
}

export async function toggleCouponActive(
  id: string,
  isActive: boolean
): Promise<PublicCoupon> {
  const doc = await Coupon.findOneAndUpdate(
    { _id: id },
    { $set: { isActive } },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Coupon not found');
  return toPublicCoupon(doc);
}

/**
 * Non-mutating preview used by `/orders/calculate` and `/coupons/validate`.
 * Returns the discount the coupon WOULD apply — no DB writes.
 */
export async function validateCoupon(
  code: string,
  subtotal: number
): Promise<CouponValidation> {
  const coupon = await Coupon.findOne({ code: code.toUpperCase() })
    .select('isActive expiresAt usageLimit usedCount type value minPurchase maxDiscount')
    .lean()
    .exec();
  if (!coupon) {
    return { valid: false, reason: 'Coupon not found' };
  }
  if (!coupon.isActive) {
    return { valid: false, reason: 'Coupon is inactive' };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
    return { valid: false, reason: 'Coupon has expired' };
  }
  if (coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, reason: 'Coupon limit reached' };
  }
  if (subtotal < coupon.minPurchase) {
    return {
      valid: false,
      reason: `Minimum purchase ৳${coupon.minPurchase}`,
    };
  }
  let discount =
    coupon.type === 'fixed' ? coupon.value : (coupon.value / 100) * subtotal;
  if (
    coupon.type === 'percentage' &&
    coupon.maxDiscount &&
    discount > coupon.maxDiscount
  ) {
    discount = coupon.maxDiscount;
  }
  discount = Math.min(Math.floor(discount), subtotal);
  return { valid: true, discount, code: coupon.code };
}