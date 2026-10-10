import { z } from 'zod';
import {
  fileIdLike,
  idParamSchema,
  masterListQuerySchema,
  slugLike,
  urlLike,
} from '../_shared/validation';

export const createTimeSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: slugLike.optional(),
    image: urlLike,
    imageFileId: fileIdLike,
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateTimeSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    slug: slugLike.optional(),
    image: urlLike.optional(),
    imageFileId: fileIdLike.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const timeIdParamSchema = idParamSchema;

export const listTimeQuerySchema = masterListQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
});