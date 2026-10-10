import { z } from 'zod';
import {
  fileIdLike,
  idParamSchema,
  masterListQuerySchema,
  slugLike,
  urlLike,
} from '../_shared/validation';

export const createOccasionSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: slugLike.optional(),
    image: urlLike,
    imageFileId: fileIdLike,
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateOccasionSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    slug: slugLike.optional(),
    image: urlLike.optional(),
    imageFileId: fileIdLike.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const occasionIdParamSchema = idParamSchema;

export const listOccasionQuerySchema = masterListQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
});