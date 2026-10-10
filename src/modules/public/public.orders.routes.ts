import { Router } from 'express';
import { validate } from '../../middleware/validateRequest';
import { z } from 'zod';
import { getPublicOrderByNumber } from './public.orders.controller';

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

export default router;
