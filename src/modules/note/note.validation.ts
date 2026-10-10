import { z } from 'zod';
import {
  fileIdLike,
  idParamSchema,
  masterListQuerySchema,
  slugLike,
  urlLike,
} from '../_shared/validation';

export const createNoteSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: slugLike.optional(),
    image: urlLike,
    imageFileId: fileIdLike,
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateNoteSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    slug: slugLike.optional(),
    image: urlLike.optional(),
    imageFileId: fileIdLike.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const noteIdParamSchema = idParamSchema;

export const listNoteQuerySchema = masterListQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
});