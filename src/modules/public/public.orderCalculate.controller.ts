import type { Request, Response } from 'express';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { calculateOrder } from '../order/order.service';

/**
 * POST /api/public/orders/calculate
 *
 * Public order preview — the storefront's authoritative pricing.
 *
 * WHY THIS EXISTS
 *
 * `/api/orders/calculate` is ADMIN-ONLY (`adminOnly` in the order routes),
 * so the storefront had no way to ask the server what a cart actually
 * costs. The checkout page therefore computed the total entirely on the
 * client: product prices came from the cart, the shipping charge came from
 * the cached settings blob, and the coupon discount came from a separate
 * public endpoint. Three sources that could disagree with the server —
 * and the order is priced a FOURTH time server-side when it is created.
 *
 * A mismatch here is visible to the customer: the checkout total says one
 * thing, and the order that lands says another.
 *
 * This endpoint makes the server the single source of truth for the
 * preview. It is the SAME `calculateOrder` service the order-creation path
 * uses, so the preview and the order agree by construction.
 *
 * IT IS NON-MUTATING
 *
 * `calculateOrder` performs no writes — it resolves products, prices the
 * lines, previews the coupon and computes shipping. No stock is deducted
 * and no coupon usage is consumed. That makes it safe to call on every cart
 * change, and safe to expose publicly.
 *
 * SECURITY
 *
 * The endpoint accepts the customer's own cart, so it reflects the
 * customer's own cart. It cannot be used to probe other people's orders,
 * and a tampered body cannot change what the customer is ultimately
 * charged — the order is priced again server-side when it is created.
 */
export const calculatePublicOrder = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await calculateOrder(req.body);

    return sendResponse(res, { message: 'Order preview calculated', data });
  }
);
