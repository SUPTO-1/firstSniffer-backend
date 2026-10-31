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
import { BD_MOBILE_REGEX } from '../user/user.constants';

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

/**
 * Guest buyer details supplied by an anonymous storefront visitor.
 *
 * `phone` is REQUIRED (it is the only way to reach a guest for delivery,
 * and the key used to find their guest user record). `email` is optional.
 */
const guestInfoInput = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    phone: z
      .string()
      .trim()
      .regex(BD_MOBILE_REGEX, 'Enter a valid Bangladeshi mobile (e.g. 01712345678)'),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(200)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    label: z.string().trim().max(40).optional(),
    district: bdDistrictEnum,
    area: bdAreaEnum,
    address: addressLineEnum,
  })
  .strict();

export const createOrderSchema = z
  .object({
    /**
     * The customer account the order belongs to. Optional — a guest order
     * omits it and supplies `guestInfo` instead.
     */
    customer: objectId.optional(),
    /**
     * Guest buyer details. Present only on anonymous checkout orders.
     */
    guestInfo: guestInfoInput.optional(),
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
    /* Payment evidence supplied by the customer at checkout (bKash /
     * Nagad sender number + TrxID). Optional because the storefront
     * collects them but COD orders never have them. */
    paymentDetails: z
      .object({
        senderMobile: z
          .string()
          .trim()
          .regex(BD_MOBILE_REGEX, 'Enter a valid Bangladeshi mobile (e.g. 01712345678)'),
        transactionId: z.string().trim().min(6).max(120),
      })
      .strict()
      .optional(),
    /* Optional in-body idempotency key. The `Idempotency-Key` HEADER is
     * the preferred channel (the controller merges it in), but accepting
     * it in the body too lets clients that cannot set headers still get
     * retry-safety. */
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    /* An order must identify WHO it belongs to — either a registered
     * customer account, or a guest's own details. Never neither. */
    if (!val.customer && !val.guestInfo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Either a customer account or guest details are required to place an order',
        path: [],
      });
    }
    /* Supplying both is ambiguous: the guest snapshot would silently
     * disagree with the referenced account. Reject it outright rather
     * than silently picking one. */
    if (val.customer && val.guestInfo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide either a customer account or guest details, not both',
        path: [],
      });
    }
  });

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

/* ----- Manual review (admin only) -----
 * At least one of image or comment is required. Zod's superRefine runs
 * after object validation so we can return a friendly top-level error.
 */
export const orderReviewBodySchema = z
  .object({
    image: z
      .object({
        url: z.string().url('Image URL is invalid'),
        fileId: z.string().trim().min(1, 'Image fileId is required'),
      })
      .optional(),
    comment: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.image && !val.comment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of image or comment is required',
        path: [],
      });
    }
  });

/* ----- Manual payment (admin only) ----- */
export const orderPaymentBodySchema = z
  .object({
    amount: z
      .number()
      .int('Amount must be a whole number')
      .positive('Amount must be greater than zero'),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/* ----- Invoice params (admin / public) ----- */
export const invoiceParamsSchema = z
  .object({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid order id') })
  .strict();

export const invoicePublicParamsSchema = z
  .object({
    orderNumber: z
      .string()
      .trim()
      .min(3, 'Order number is required')
      .max(64, 'Order number is too long')
      .regex(/^[A-Z0-9-]+$/i, 'Order number must contain only letters, numbers and dashes'),
  })
  .strict();
