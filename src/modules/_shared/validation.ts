import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const slugLike = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes only');

export const urlLike = z
  .string()
  .trim()
  .url('Must be a valid URL (ImageKit)');

export const fileIdLike = z.string().trim().min(1).max(128);

/**
 * Paged-list query schema shared by every master-data module. Uses
 * `.passthrough()` so unknown keys are silently dropped by the Query Builder
 * whitelist rather than rejected by Zod.
 */
export const masterListQuerySchema = z
  .object({
    search: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    sort: z.string().optional(),
  })
  .passthrough();

export const idParamSchema = z.object({ id: objectId }).strict();

/**
 * Product variant sizes — fixed enum. Used by both the Product schema
 * (variants[].size) and the Inventory schema (bottleSize). Adding/removing
 * a size here is a breaking change that requires a DB migration.
 */
export const productSizeEnum = z.enum(['3ml', '5ml', '10ml', '30ml']);
export type ProductSize = z.infer<typeof productSizeEnum>;
export const PRODUCT_SIZES = ['3ml', '5ml', '10ml', '30ml'] as const;

/** Coerced non-negative integer (used for ml / qty). */
export const nonNegativeInt = z.coerce.number().int().min(0);

/** Coerced positive integer (used for ml / price > 0). */
export const positiveInt = z.coerce.number().int().positive();

/* ============================================================
 * Commerce-module shared enums (Orders, Reviews, Coupons, etc.)
 * ============================================================ */

/** Order lifecycle. See plan §6.1 — state machine. */
export const orderStatusEnum = z.enum([
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
]);
export type OrderStatus = z.infer<typeof orderStatusEnum>;

/** Payment lifecycle. Independent of orderStatus. */
export const paymentStatusEnum = z.enum([
  'unpaid',
  'pending_verification',
  'paid',
  'refunded',
  'failed',
]);
export type PaymentStatus = z.infer<typeof paymentStatusEnum>;

/** Where the order came from — online checkout vs manual admin order. */
export const orderSourceEnum = z.enum(['online', 'manual']);
export type OrderSource = z.infer<typeof orderSourceEnum>;

/** Payment-method type enum — matches PaymentMethod model. */
export const paymentMethodTypeEnum = z.enum([
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'cod',
]);
export type PaymentMethodType = z.infer<typeof paymentMethodTypeEnum>;

/** Coupon type — fixed ৳ discount vs percentage off. */
export const couponTypeEnum = z.enum(['fixed', 'percentage']);
export type CouponType = z.infer<typeof couponTypeEnum>;

/** Review moderation status. */
export const reviewStatusEnum = z.enum(['pending', 'approved', 'rejected']);
export type ReviewStatus = z.infer<typeof reviewStatusEnum>;

/** Shipping-zone id — used by /orders/calculate and checkout. */
export const shippingZoneEnum = z.enum(['inside-ctg', 'outside-ctg']);
export type ShippingZoneId = z.infer<typeof shippingZoneEnum>;

/* ============================================================
 * Address helpers (used by Order shippingAddress snapshot and
 * by inline-customer creation).
 * ============================================================ */

export const bdDistrictEnum = z.string().trim().min(1).max(80);
export const bdAreaEnum = z.string().trim().min(1).max(120);
export const addressLineEnum = z.string().trim().min(1).max(300);

/* ============================================================
 * Order line shapes (used by Order create + /orders/calculate).
 * ============================================================ */

/** Millilitre quantity for an order line — positive integer, capped. */
export const mlQty = z.coerce.number().int().positive().max(10_000);

/** A single order line — plain product by (product, size, ml). */
export const orderItemInput = z
  .object({
    product: objectId,
    size: productSizeEnum,
    millilitres: mlQty,
  })
  .strict();
export type OrderItemInput = z.infer<typeof orderItemInput>;

/** A combo line at order-create — quantity of an existing Combo. */
export const orderComboItemInput = z
  .object({
    combo: objectId,
    quantity: z.coerce.number().int().positive().max(999),
  })
  .strict();
export type OrderComboItemInput = z.infer<typeof orderComboItemInput>;
