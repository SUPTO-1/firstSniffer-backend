import { Router } from 'express';
import { validate } from '../../middleware/validateRequest';
import { z } from 'zod';
import { getPublicOrderByNumber, getPublicInvoiceByNumber } from './public.orders.controller';

const router = Router();

// No auth — public storefront.

const orderNumberParamSchema = z
  .object({
    orderNumber: z
      .string()
      .trim()
      .min(3, 'Order number is required')
      .max(64, 'Order number is too long')
      .regex(/^[A-Z0-9-]+$/i, 'Order number must contain only letters, numbers and dashes'),
  })
  .strict();

router.get(
  '/:orderNumber',
  validate(orderNumberParamSchema, 'params'),
  getPublicOrderByNumber
);

// Public invoice PDF — same order-number capability as the lookup. No
// payments log (admin-only). Returns 404 on unknown orderNumber so we
// don't offer a cheap oracle to brute-force attempts.
router.get(
  '/:orderNumber/invoice',
  validate(orderNumberParamSchema, 'params'),
  getPublicInvoiceByNumber
);

export default router;
