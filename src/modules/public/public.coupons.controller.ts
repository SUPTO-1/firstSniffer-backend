import type { Request, Response } from 'express';
import { sendResponse, sendError } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { validateCoupon } from '../coupon/coupon.service';

/**
 * GET /api/public/coupons/validate?code=XXXX&subtotal=2500
 *
 * Public coupon preview for the checkout form.
 *
 * WHY THIS EXISTS
 *
 * The admin-only `/api/coupons/validate` endpoint did the job correctly,
 * but the storefront has no admin session — so the customer could not check
 * whether their coupon code was valid, and the checkout form had no coupon
 * field at all. Coupons were unbuyable from the storefront even though the
 * order backend has always supported `couponCode`.
 *
 * SECURITY
 *
 * This only reveals whether a code is valid and what it would discount.
 * That is the same information the customer would learn by entering the
 * code at checkout. It does NOT reveal the coupon's other properties
 * (usage limits, who created it, expiry policy beyond "expired").
 *
 * It is NON-MUTATING — `validateCoupon` performs no writes, so a customer
 * cannot burn a coupon's usage count by probing codes.
 */
export const validatePublicCoupon = asyncHandler(
  async (req: Request, res: Response) => {
    const q = req.query as Record<string, unknown>;

    const code = String(q.code ?? '').trim().toUpperCase();
    if (code.length === 0) {
      return sendError(res, 400, 'Coupon code is required');
    }

    /**
     * The subtotal is used to evaluate percentage discounts and the
     * minimum-purchase rule. It is the customer's own cart, so accepting
     * it from the client is fine — the ORDER is priced server-side again
     * at creation time, so a tampered subtotal cannot change what the
     * customer is charged.
     */
    const subtotalRaw = Number(q.subtotal ?? 0);
    const subtotal =
      Number.isFinite(subtotalRaw) && subtotalRaw > 0 ? subtotalRaw : 0;

    const result = await validateCoupon(code, subtotal);

    return sendResponse(res, {
      message: result.valid
        ? 'Coupon is valid'
        : (result.reason ?? 'Coupon is not valid'),
      data: {
        code,
        valid: result.valid,
        discount: result.valid ? result.discount : 0,
        reason: result.valid ? undefined : result.reason,
      },
    });
  }
);
