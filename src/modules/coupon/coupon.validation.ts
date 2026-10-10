import { z } from 'zod';
import {
  idParamSchema,
  masterListQuerySchema,
  positiveInt,
} from '../_shared/validation';

export const listCouponQuerySchema = masterListQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
  type: z.enum(['fixed', 'percentage']).optional(),
});

export const couponIdParamSchema = idParamSchema;

export const createCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_-]+$/, 'Uppercase letters, numbers, underscores and dashes only')
      .transform((s) => s.toUpperCase()),
    type: z.enum(['fixed', 'percentage']),
    value: z.coerce.number().min(0),
    minPurchase: z.coerce.number().min(0).optional(),
    maxDiscount: z.coerce.number().min(0).optional(),
    expiresAt: z.coerce.date().optional(),
    usageLimit: positiveInt,
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateCouponSchema = createCouponSchema.partial();

export const couponActiveToggleSchema = z
  .object({ isActive: z.boolean() })
  .strict();

export const validateCouponQuerySchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    subtotal: z.coerce.number().min(0),
  })
  .strict();