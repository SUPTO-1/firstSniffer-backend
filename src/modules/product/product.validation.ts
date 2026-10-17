import { z } from 'zod';
import {
  fileIdLike,
  idParamSchema,
  masterListQuerySchema,
  nonNegativeInt,
  objectId,
  productSizeEnum,
  slugLike,
} from '../_shared/validation';

const imageSchema = z.object({
  url: z.string().trim().min(1).max(500),
  fileId: fileIdLike,
  alt: z.string().trim().max(200).optional().default(''),
});

const variantSchema = z.object({
  size: productSizeEnum,
  price: z.coerce.number().min(0, 'Price must be ≥ 0'),
});

const notesBlockSchema = z.object({
  top: z.array(objectId).optional().default([]),
  middle: z.array(objectId).optional().default([]),
  base: z.array(objectId).optional().default([]),
});

const performanceSchema = z.object({
  longevity: z
    .enum(['low', 'moderate', 'long-lasting', 'eternal'])
    .optional()
    .default('moderate'),
  projection: z
    .enum(['soft', 'moderate', 'strong', 'beast-mode'])
    .optional()
    .default('moderate'),
  versatility: z
    .enum(['niche', 'moderate', 'versatile'])
    .optional()
    .default('moderate'),
});

const baseFields = {
  name: z.string().trim().min(2).max(120),
  slug: slugLike.optional(),
  description: z.string().trim().max(4000).optional().default(''),
  brand: objectId,
  genres: z.array(objectId).optional().default([]),
  notes: notesBlockSchema.optional(),
  gender: z.enum(['masculine', 'feminine', 'unisex']).optional().default('unisex'),
  seasons: z.array(objectId).optional().default([]),
  occasions: z.array(objectId).optional().default([]),
  weathers: z.array(objectId).optional().default([]),
  times: z.array(objectId).optional().default([]),
  performance: performanceSchema.optional(),
  images: z.array(imageSchema).optional().default([]),
  variants: z.array(variantSchema).min(1, 'At least one variant is required'),
  defaultAtomizer: objectId.optional(),
  aliases: z.array(z.string().trim().max(120)).optional().default([]),
  featured: z.boolean().optional().default(false),
  bestSelling: z.boolean().optional().default(false),
  topRated: z.boolean().optional().default(false),
  newArrival: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
};

export const createProductSchema = z.object(baseFields).strict();

const updateFields = {
  name: z.string().trim().min(2).max(120).optional(),
  slug: slugLike.optional(),
  description: z.string().trim().max(4000).optional(),
  brand: objectId.optional(),
  genres: z.array(objectId).optional(),
  notes: notesBlockSchema.optional(),
  gender: z.enum(['masculine', 'feminine', 'unisex']).optional(),
  seasons: z.array(objectId).optional(),
  occasions: z.array(objectId).optional(),
  weathers: z.array(objectId).optional(),
  times: z.array(objectId).optional(),
  performance: performanceSchema.optional(),
  images: z.array(imageSchema).optional(),
  variants: z.array(variantSchema).min(1, 'At least one variant is required').optional(),
  defaultAtomizer: objectId.optional(),
  aliases: z.array(z.string().trim().max(120)).optional(),
  featured: z.boolean().optional(),
  bestSelling: z.boolean().optional(),
  topRated: z.boolean().optional(),
  newArrival: z.boolean().optional(),
  isActive: z.boolean().optional(),
};
export const updateProductSchema = z.object(updateFields).strict();

export const productIdParamSchema = idParamSchema;

export const updateProductImagesSchema = z
  .object({
    add: z.array(imageSchema).optional().default([]),
    remove: z.array(fileIdLike).optional().default([]),
    reorder: z.array(fileIdLike).optional().default([]),
  })
  .strict();

export const listProductQuerySchema = masterListQuerySchema.extend({
  brand: objectId.optional(),
  gender: z.enum(['masculine', 'feminine', 'unisex']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  featured: z.enum(['true', 'false']).optional(),
  bestSelling: z.enum(['true', 'false']).optional(),
  topRated: z.enum(['true', 'false']).optional(),
  newArrival: z.enum(['true', 'false']).optional(),
  seasons: z.string().optional(),
  occasions: z.string().optional(),
  weathers: z.string().optional(),
  times: z.string().optional(),
  genres: z.string().optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
});

// re-export for callers
export { nonNegativeInt, productSizeEnum };
