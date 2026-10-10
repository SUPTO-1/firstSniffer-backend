import { z } from 'zod';
import {
  idParamSchema,
  masterListQuerySchema,
  nonNegativeInt,
  objectId,
  positiveInt,
  productSizeEnum,
} from '../_shared/validation';

export const createInventorySchema = z
  .object({
    product: objectId,
    bottleSize: productSizeEnum,
    totalMl: nonNegativeInt,
    reservedBufferMl: nonNegativeInt.optional(),
    remainingMl: nonNegativeInt,
    purchaseCost: nonNegativeInt,
    lowStockThresholdMl: nonNegativeInt.optional(),
  })
  .strict();

export const updateInventorySchema = z
  .object({
    purchaseCost: nonNegativeInt.optional(),
    lowStockThresholdMl: nonNegativeInt.optional(),
    reservedBufferMl: nonNegativeInt.optional(),
  })
  .strict();

export const adjustInventorySchema = z
  .object({
    /** Signed delta in ml. Negative decreases remainingMl; positive increases it. */
    deltaMl: z.coerce.number().int(),
    note: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const releaseBufferSchema = z
  .object({
    /** Positive ml to release from reservedBufferMl into remainingMl. */
    quantityMl: positiveInt,
    note: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const recordSaleSchema = z
  .object({
    /** Positive ml to deduct from remainingMl. */
    quantityMl: positiveInt,
    /** Optional reference id (e.g. order id from the future Orders module). */
    referenceId: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const inventoryIdParamSchema = idParamSchema;

export const listInventoryQuerySchema = masterListQuerySchema.extend({
  product: objectId.optional(),
  bottleSize: productSizeEnum.optional(),
});