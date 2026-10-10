import { z } from 'zod';
import {
  idParamSchema,
  masterListQuerySchema,
  objectId,
  reviewStatusEnum,
} from '../_shared/validation';

export const listReviewQuerySchema = masterListQuerySchema.extend({
  status: reviewStatusEnum.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  product: objectId.optional(),
  customer: objectId.optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

export const reviewIdParamSchema = idParamSchema;

export const createReviewSchema = z
  .object({
    product: objectId,
    customer: objectId,
    rating: z.coerce.number().int().min(1).max(5),
    title: z.string().trim().min(2).max(200),
    comment: z.string().trim().min(2).max(4000),
    images: z
      .array(
        z
          .object({
            url: z.string().trim().default(''),
            fileId: z.string().trim().default(''),
          })
          .strict()
      )
      .max(6)
      .optional(),
    status: reviewStatusEnum.optional(),
  })
  .strict();

export const updateReviewSchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5).optional(),
    title: z.string().trim().min(2).max(200).optional(),
    comment: z.string().trim().min(2).max(4000).optional(),
    images: z
      .array(
        z
          .object({
            url: z.string().trim().default(''),
            fileId: z.string().trim().default(''),
          })
          .strict()
      )
      .max(6)
      .optional(),
    status: reviewStatusEnum.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const reviewStatusSchema = z
  .object({ status: reviewStatusEnum })
  .strict();