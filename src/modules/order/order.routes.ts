import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { rateLimiter } from '../../middleware/rateLimiter';
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
 * Guard for the storefront checkout.
 *
 * The order POST is reachable by THREE kinds of caller:
 *
 *  1. **Admins** (manual order entry on the dashboard) — may place an
 *     order for any customer.
 *  2. **Signed-in customers** (online checkout) — may only place an order
 *     against their own user id.
 *  3. **Guests** (anonymous checkout) — may place an order by supplying
 *     their own `guestInfo` (name + phone + address). No account is
 *     required and none is implied.
 *
 * A guest order is only accepted when the body carries `guestInfo` and NO
 * `customer`. The service layer re-checks this, so a client cannot smuggle
 * a guest order through by omitting the field and expecting a fallback.
 */
function customerAdminOrGuest(
  req: import('express').Request,
  _res: import('express').Response,
  next: import('express').NextFunction
): void {
  const body = (req.body ?? {}) as {
    customer?: unknown;
    guestInfo?: unknown;
  };

  const hasGuestInfo =
    !!body.guestInfo && typeof body.guestInfo === 'object' && body.guestInfo !== null;
  const hasCustomer = typeof body.customer === 'string' && body.customer.length > 0;

  /* --- Case 3: guest checkout (no auth at all) --- */
  if (!req.user) {
    if (hasGuestInfo && !hasCustomer) {
      return next();
    }
    /* No identity signal at all → the caller simply is not signed in.
     * If they DID name somebody else's account, that is also a
     * 401 — an anonymous caller must never place an order against an
     * arbitrary customer id. */
    return next(ApiError.unauthorized('Authentication required'));
  }

  /* --- Case 1: admin --- */
  if (req.user.role === 'admin') return next();

  /* --- Case 2: signed-in customer ordering for themselves --- */
  if (!hasCustomer) {
    return next(ApiError.badRequest('Customer is required'));
  }
  if (body.customer !== req.user.id) {
    return next(ApiError.forbidden('You can only place orders for yourself'));
  }
  return next();
}

/**
 * Storefront checkout — admins, signed-in customers, and guests.
 *
 * This route deliberately sits ABOVE `router.use(authRequired)`: guest
 * checkout must work without a token. Every other route in this module
 * still requires authentication.
 *
 * RATE LIMITING: because this route is reachable without authentication,
 * it is capped at 10 order creations per IP per minute. Without it, an
 * anonymous endpoint that writes to the database and deducts stock is a
 * spam/abuse vector — a bot could flood the shop with unpaid orders and
 * lock out real inventory. The limit is generous enough that a genuine
 * shopper (or a shared NAT office IP) never hits it.
 *
 * MIDDLEWARE ORDER: `validate` runs BEFORE `customerAdminOrGuest` on
 * purpose. The schema owns the "who is this order for?" question — it
 * rejects a body with NEITHER identity and a body with BOTH. If the guard
 * ran first, an anonymous caller with no identity would get a flat 401
 * ("Authentication required") instead of the actionable 400 that tells
 * them they need to supply guest details. Validation is auth-independent
 * and touches no data, so running it first leaks nothing: the guard still
 * has the final say on whether a named `customer` is the caller's own.
 */
router.post(
  '/',
  rateLimiter({ windowMs: 60_000, max: 10 }),
  validate(createOrderSchema),
  customerAdminOrGuest,
  controller.createOrder
);

// Every route below needs an authenticated user; admin-only routes stack
// `adminOnly` on top.
router.use(authRequired);

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