import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './order.controller';
import {
  cancelOrderSchema,
  createOrderSchema,
  calculateOrderSchema,
  invoiceParamsSchema,
  listOrderQuerySchema,
  orderIdParamSchema,
  orderPaymentBodySchema,
  orderReviewBodySchema,
  updateOrderPaymentStatusSchema,
  updateOrderStatusSchema,
} from './order.validation';
import { ApiError } from '../../utils/ApiError';

// Note: a generic PUT /:id was intentionally omitted from the public route
// surface — order-edit from the admin panel goes through the dedicated
// updateDetails service (used by future Edit dialog when status='pending').

const router = Router();

/**
 * Guard for the storefront checkout. The order POST is reachable by both
 * admins (manual order entry) and customers (online checkout). Customers
 * may only place orders against their own user id; admins can place orders
 * for any customer (manual entry on the dashboard).
 */
function customerOrAdmin(
  req: import('express').Request,
  _res: import('express').Response,
  next: import('express').NextFunction
): void {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }
  if (req.user.role === 'admin') return next();
  // Storefront customer: must be placing an order for themselves.
  const bodyCustomer = (req.body as { customer?: unknown })?.customer;
  if (typeof bodyCustomer !== 'string' || bodyCustomer.length === 0) {
    return next(ApiError.badRequest('Customer is required'));
  }
  if (bodyCustomer !== req.user.id) {
    return next(ApiError.forbidden('You can only place orders for yourself'));
  }
  return next();
}

// Every route below needs an authenticated user; admin-only routes stack
// `adminOnly` on top. The order POST is intentionally NOT admin-only so the
// storefront checkout (signed-in customer placing their own order) works.
router.use(authRequired);

// Storefront checkout — authenticated customers OR admins.
router.post(
  '/',
  customerOrAdmin,
  validate(createOrderSchema),
  controller.createOrder
);

// Admin-only — list/calculate/get/update/cancel.
router.get('/', adminOnly, validate(listOrderQuerySchema, 'query'), controller.listOrders);
router.post(
  '/calculate',
  adminOnly,
  validate(calculateOrderSchema),
  controller.calculateOrder
);
router.get(
  '/:id',
  adminOnly,
  validate(orderIdParamSchema, 'params'),
  controller.getOrder
);
router.patch(
  '/:id/status',
  adminOnly,
  validate(orderIdParamSchema, 'params'),
  validate(updateOrderStatusSchema),
  controller.updateStatus
);
router.patch(
  '/:id/payment-status',
  adminOnly,
  validate(orderIdParamSchema, 'params'),
  validate(updateOrderPaymentStatusSchema),
  controller.updatePaymentStatus
);
router.post(
  '/:id/cancel',
  adminOnly,
  validate(orderIdParamSchema, 'params'),
  validate(cancelOrderSchema),
  controller.cancelOrder
);

// Manual reviews
router.get(
  '/:id/reviews',
  adminOnly,
  validate(orderIdParamSchema, 'params'),
  controller.listOrderReviews
);
router.post(
  '/:id/reviews',
  adminOnly,
  validate(orderIdParamSchema, 'params'),
  validate(orderReviewBodySchema),
  controller.createOrderReview
);

// Manual payments
router.get(
  '/:id/payments',
  adminOnly,
  validate(orderIdParamSchema, 'params'),
  controller.listOrderPayments
);
router.post(
  '/:id/payments',
  adminOnly,
  validate(orderIdParamSchema, 'params'),
  validate(orderPaymentBodySchema),
  controller.createOrderPayment
);

// Invoice PDF (admin view — includes payments log)
router.get(
  '/:id/invoice',
  adminOnly,
  validate(invoiceParamsSchema, 'params'),
  controller.streamAdminInvoice
);

export default router;