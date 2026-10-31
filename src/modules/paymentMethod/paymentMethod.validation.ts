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
  advancePaymentRequired: z.boolean().optional().default(false),
  advancePaymentPercent: z.coerce.number().min(0).max(100).optional().default(0),
};

/**
 * Advance-payment percentage rules.
 *
 * - The percentage must be strictly greater than 0 and at most 100 WHEN
 *   the advance is enabled. A percentage of 0 (or a negative value) would
 *   mean "no advance required" while the toggle claims there is one —
 *   silently contradicting the admin's own configuration.
 * - When the advance is DISABLED the percentage is irrelevant, so it is
 *   normalised to 0 rather than rejected. That keeps the stored config
 *   unambiguous and guarantees a disabled method never affects any
 *   calculation.
 */
function refineAdvance(
  data: { advancePaymentRequired?: boolean; advancePaymentPercent?: number },
  ctx: z.RefinementCtx
): void {
  if (data.advancePaymentRequired !== true) return;
  const percent = data.advancePaymentPercent ?? 0;
  if (percent <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['advancePaymentPercent'],
      message: 'Advance payment percentage must be greater than 0',
    });
  }
  if (percent > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['advancePaymentPercent'],
      message: 'Advance payment percentage cannot be greater than 100',
    });
  }
}

/* Account fields are optional because `cod` has no account. Cross-field
 * refinement is applied at the controller/service layer so the same
 * shape works for create + update. */
export const createPaymentMethodSchema = z
  .object(baseFields)
  .strict()
  .superRefine(refineAdvance);
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
    advancePaymentRequired: baseFields.advancePaymentRequired,
    advancePaymentPercent: baseFields.advancePaymentPercent,
  })
  .strict()
  .superRefine(refineAdvance);

export const paymentMethodIdParamSchema = idParamSchema;

/* list — extends masterListQuerySchema with type/isActive filter enums */
export const listPaymentMethodQuerySchema = masterListQuerySchema.extend({
  type: z.enum(['bkash', 'nagad', 'rocket', 'bank', 'cod']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

export const paymentMethodActiveToggleSchema = z
  .object({ isActive: z.boolean() })
  .strict();
