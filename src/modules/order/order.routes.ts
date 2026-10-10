import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './order.controller';
import {
  cancelOrderSchema,
  createOrderSchema,
  calculateOrderSchema,
  listOrderQuerySchema,
  orderIdParamSchema,
  updateOrderPaymentStatusSchema,
  updateOrderStatusSchema,
} from './order.validation';

// Note: a generic PUT /:id was intentionally omitted from the public route
// surface — order-edit from the admin panel goes through the dedicated
// updateDetails service (used by future Edit dialog when status='pending').

const router = Router();

router.use(authRequired, adminOnly);

router.get('/', validate(listOrderQuerySchema, 'query'), controller.listOrders);
router.post('/calculate', validate(calculateOrderSchema), controller.calculateOrder);
router.post('/', validate(createOrderSchema), controller.createOrder);
router.get(
  '/:id',
  validate(orderIdParamSchema, 'params'),
  controller.getOrder
);
router.patch(
  '/:id/status',
  validate(orderIdParamSchema, 'params'),
  validate(updateOrderStatusSchema),
  controller.updateStatus
);
router.patch(
  '/:id/payment-status',
  validate(orderIdParamSchema, 'params'),
  validate(updateOrderPaymentStatusSchema),
  controller.updatePaymentStatus
);
router.post(
  '/:id/cancel',
  validate(orderIdParamSchema, 'params'),
  validate(cancelOrderSchema),
  controller.cancelOrder
);

export default router;