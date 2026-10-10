import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './paymentMethod.controller';
import {
  createPaymentMethodSchema,
  listPaymentMethodQuerySchema,
  paymentMethodActiveToggleSchema,
  paymentMethodIdParamSchema,
  updatePaymentMethodSchema,
} from './paymentMethod.validation';

const router = Router();

/* Public — used by the storefront checkout. Must come before the
 * `authRequired` middleware. */
router.get('/active', controller.listActivePaymentMethods);

router.use(authRequired, adminOnly);

router.get(
  '/',
  validate(listPaymentMethodQuerySchema, 'query'),
  controller.listPaymentMethods
);
router.post(
  '/',
  validate(createPaymentMethodSchema),
  controller.createPaymentMethod
);
router.get(
  '/:id',
  validate(paymentMethodIdParamSchema, 'params'),
  controller.getPaymentMethod
);
router.put(
  '/:id',
  validate(paymentMethodIdParamSchema, 'params'),
  validate(updatePaymentMethodSchema),
  controller.updatePaymentMethod
);
router.delete(
  '/:id',
  validate(paymentMethodIdParamSchema, 'params'),
  controller.removePaymentMethod
);
router.patch(
  '/:id/active',
  validate(paymentMethodIdParamSchema, 'params'),
  validate(paymentMethodActiveToggleSchema),
  controller.toggleActive
);

export default router;
