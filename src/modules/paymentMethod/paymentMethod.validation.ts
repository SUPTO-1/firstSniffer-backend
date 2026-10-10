import { z } from 'zod';
import {
  fileIdLike,
  idParamSchema,
  masterListQuerySchema,
  paymentMethodTypeEnum,
  urlLike,
} from '../_shared/validation';

const mediaRefSchema = z
  .object({
    url: z.union([z.literal(''), urlLike]).optional(),
    fileId: fileIdLike.optional(),
  })
  .strict();

const baseFields = {
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  type: paymentMethodTypeEnum,
  accountNumber: z.string().trim().max(80).optional().default(''),
  accountName: z.string().trim().max(80).optional().default(''),
  qrImage: mediaRefSchema.optional(),
  instructions: z
    .array(z.string().trim().min(1).max(300))
    .max(10, 'Max 10 instructions')
    .optional()
    .default([]),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
};

/* Account fields are optional because `cod` has no account. Cross-field
 * refinement is applied at the controller/service layer so the same
 * shape works for create + update. */
export const createPaymentMethodSchema = z.object(baseFields).strict();
export const updatePaymentMethodSchema = z
  .object({
    name: baseFields.name.optional(),
    type: baseFields.type.optional(),
    accountNumber: baseFields.accountNumber,
    accountName: baseFields.accountName,
    qrImage: mediaRefSchema.optional(),
    instructions: baseFields.instructions,
    displayOrder: baseFields.displayOrder,
    isActive: baseFields.isActive,
  })
  .strict();

export const paymentMethodIdParamSchema = idParamSchema;

/* list — extends masterListQuerySchema with type/isActive filter enums */
export const listPaymentMethodQuerySchema = masterListQuerySchema.extend({
  type: z.enum(['bkash', 'nagad', 'rocket', 'bank', 'cod']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

export const paymentMethodActiveToggleSchema = z
  .object({ isActive: z.boolean() })
  .strict();
