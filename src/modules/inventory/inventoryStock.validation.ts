import { z } from 'zod';
import { idParamSchema } from '../_shared/validation';

/** `GET /api/inventory/stock/:productId` */
export const productStockParamSchema = idParamSchema;

/** `PATCH /api/inventory/settings/:productId` */
export const updateInventorySettingsSchema = z
  .object({
    safetyBufferMl: z.coerce.number().min(0).optional(),
    lowStockThresholdMl: z.coerce.number().min(0).optional(),
  })
  .strict();

export const productSettingsParamSchema = idParamSchema;
