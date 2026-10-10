import { z } from 'zod';
import {
  fileIdLike,
  idParamSchema,
  masterListQuerySchema,
  slugLike,
  urlLike,
} from '../_shared/validation';

const sizeSchema = z.object({
  size: z.string().trim().min(1, 'Size is required').max(40),
  additionalPrice: z.coerce.number().min(0, 'Must be ≥ 0'),
});

export const createAtomizerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: slugLike.optional(),
    image: urlLike,
    imageFileId: fileIdLike,
    sizes: z.array(sizeSchema).min(1, 'At least one size is required'),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateAtomizerSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    slug: slugLike.optional(),
    image: urlLike.optional(),
    imageFileId: fileIdLike.optional(),
    sizes: z.array(sizeSchema).min(1, 'At least one size is required').optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const atomizerIdParamSchema = idParamSchema;

export const listAtomizerQuerySchema = masterListQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
});