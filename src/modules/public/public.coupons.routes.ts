import { Router } from 'express';
import { validatePublicCoupon } from './public.coupons.controller';

const router = Router();

// No auth — public storefront.
router.get('/validate', validatePublicCoupon);

export default router;
