import { z } from 'zod';
import {
  addressLineEnum,
  bdAreaEnum,
  bdDistrictEnum,
  idParamSchema,
  masterListQuerySchema,
  objectId,
  orderComboItemInput,
  orderItemInput,
  orderSourceEnum,
  paymentStatusEnum,
  shippingZoneEnum,
} from '../_shared/validation';

const shippingAddressInput = z
  .object({
    label: z.string().trim().max(40).optional(),
    district: bdDistrictEnum,
    area: bdAreaEnum,
    address: addressLineEnum,
  })
  .strict();

/* ----- List query ----- */
export const listOrderQuerySchema = masterListQuerySchema.extend({
  orderSource: orderSourceEnum.optional(),
  paymentStatus: paymentStatusEnum.optional(),
  orderStatus: z
    .enum([
      'pending',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'returned',
    ])
    .optional(),
  customer: objectId.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const orderIdParamSchema = idParamSchema;

/* ----- Calculate (preview, no DB writes) ----- */
export const calculateOrderSchema = z
  .object({
    items: z.array(orderItemInput).min(1, 'At least one line is required'),
    combos: z.array(orderComboItemInput).optional(),
    shippingZone: shippingZoneEnum,
    couponCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .strict();

/* ----- Create order ----- */
export const createOrderSchema = z
  .object({
    customer: objectId,
    orderSource: orderSourceEnum.default('manual'),
    items: z.array(orderItemInput).min(1, 'At least one line is required'),
    combos: z.array(orderComboItemInput).optional(),
    shippingAddress: shippingAddressInput,
    paymentMethod: objectId.optional(),
    couponCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

/* ----- Status updates ----- */
export const updateOrderStatusSchema = z
  .object({
    orderStatus: z.enum([
      'pending',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'returned',
    ]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const updateOrderPaymentStatusSchema = z
  .object({
    paymentStatus: paymentStatusEnum,
    referenceId: z.string().trim().max(120).optional(),
  })
  .strict();

export const cancelOrderSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
