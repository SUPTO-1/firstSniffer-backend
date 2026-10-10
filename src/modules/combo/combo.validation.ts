import { z } from 'zod';
import {
  idParamSchema,
  masterListQuerySchema,
  objectId,
  productSizeEnum,
} from '../_shared/validation';

export const listComboQuerySchema = masterListQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
});

export const comboIdParamSchema = idParamSchema;

const comboComponentInput = z
  .object({
    product: objectId,
    size: productSizeEnum,
    millilitres: z.coerce.number().int().positive().max(10_000),
  })
  .strict();

export const createComboSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes only')
      .optional(),
    products: z.array(comboComponentInput).min(1, 'At least one component is required'),
    comboPrice: z.coerce.number().min(0),
    image: z
      .object({
        url: z.string().trim().default(''),
        fileId: z.string().trim().default(''),
      })
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateComboSchema = createComboSchema.partial();

export const comboActiveToggleSchema = z
  .object({ isActive: z.boolean() })
  .strict();