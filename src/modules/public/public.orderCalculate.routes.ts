import { Router } from 'express';
import { validate } from '../../middleware/validateRequest';
import { calculateOrderSchema } from '../order/order.validation';
import { calculatePublicOrder } from './public.orderCalculate.controller';

const router = Router();

// No auth — the storefront prices a guest's cart before they sign in.

/**
 * Order preview — no writes.
 *
 * The schema is the SAME one the admin endpoint uses, so the request shape
 * can never drift between the two.
 */
router.post('/calculate', validate(calculateOrderSchema), calculatePublicOrder);

export default router;
