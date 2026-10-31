import { z } from 'zod';
import {
  idParamSchema,
  masterListQuerySchema,
  objectId,
  positiveInt,
} from '../_shared/validation';

/**
 * Batch creation.
 *
 * `totalMl` and `remainingMl` are NOT accepted — they are derived server-side
 * from `sourceBottleSizeMl * quantity`. This keeps a batch from ever holding
 * an inconsistent capacity/remmaining pair.
 */
export const createInventoryBatchSchema = z
  .object({
    product: objectId,
    /** Capacity of ONE original bottle, in ml. Numeric — any size works. */
    sourceBottleSizeMl: positiveInt,
    /** How many original bottles this batch contains. */
    quantity: positiveInt,
    /** TOTAL cost paid for the batch (not per bottle, not per ml). */
    purchaseCost: z.coerce.number().min(0),
    purchaseDate: z.coerce.date().optional(),
    supplier: z.string().trim().max(120).optional().default(''),
    notes: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const updateInventoryBatchSchema = z
  .object({
    purchaseCost: z.coerce.number().min(0).optional(),
    purchaseDate: z.coerce.date().optional(),
    supplier: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const adjustInventoryBatchSchema = z
  .object({
    /** Signed delta in ml. Negative consumes; positive restocks. */
    deltaMl: z.coerce.number().int(),
    note: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const restockInventoryBatchSchema = z
  .object({
    /** Positive ml to add back to the batch without changing its capacity. */
    quantityMl: positiveInt,
    note: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const inventoryBatchIdParamSchema = idParamSchema;

export const listInventoryBatchQuerySchema = masterListQuerySchema.extend({
  product: objectId.optional(),
  isActive: z.coerce.boolean().optional(),
});
