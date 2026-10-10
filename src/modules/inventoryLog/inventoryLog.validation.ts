import { z } from 'zod';
import {
  idParamSchema,
  masterListQuerySchema,
  objectId,
} from '../_shared/validation';

export const inventoryLogTypeEnum = z.enum([
  'add',
  'sale',
  'bufferRelease',
  'adjustment',
]);

export const inventoryLogIdParamSchema = idParamSchema;

export const listInventoryLogQuerySchema = masterListQuerySchema.extend({
  type: inventoryLogTypeEnum.optional(),
  product: objectId.optional(),
  inventory: objectId.optional(),
  createdBy: objectId.optional(),
});