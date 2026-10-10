import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './coupon.controller';
import {
  couponActiveToggleSchema,
  couponIdParamSchema,
  createCouponSchema,
  listCouponQuerySchema,
  updateCouponSchema,
  validateCouponQuerySchema,
} from './coupon.validation';

const router = Router();
router.use(authRequired, adminOnly);

router.get(
  '/validate',
  validate(validateCouponQuerySchema, 'query'),
  controller.validateCoupon
);
router.get('/', validate(listCouponQuerySchema, 'query'), controller.listCoupons);
router.post('/', validate(createCouponSchema), controller.createCoupon);
router.get('/:id', validate(couponIdParamSchema, 'params'), controller.getCoupon);
router.put(
  '/:id',
  validate(couponIdParamSchema, 'params'),
  validate(updateCouponSchema),
  controller.updateCoupon
);
router.delete(
  '/:id',
  validate(couponIdParamSchema, 'params'),
  controller.removeCoupon
);
router.patch(
  '/:id/active',
  validate(couponIdParamSchema, 'params'),
  validate(couponActiveToggleSchema),
  controller.toggleActive
);

export default router;