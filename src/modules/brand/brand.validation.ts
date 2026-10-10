import { z } from 'zod';
import {
  fileIdLike,
  idParamSchema,
  masterListQuerySchema,
  slugLike,
  urlLike,
} from '../_shared/validation';

export const createBrandSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: slugLike.optional(),
    logo: urlLike,
    imageFileId: fileIdLike,
    isFeatured: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateBrandSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    slug: slugLike.optional(),
    logo: urlLike.optional(),
    imageFileId: fileIdLike.optional(),
    isFeatured: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const brandIdParamSchema = idParamSchema;

export const listBrandQuerySchema = masterListQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
  isFeatured: z.enum(['true', 'false']).optional(),
});