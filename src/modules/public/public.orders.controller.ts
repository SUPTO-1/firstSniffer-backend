import type { Request, Response } from 'express';
import { getOrderByNumber } from '../order/order.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * GET /api/public/orders/:orderNumber
 *
 * Public storefront lookup. Returns the same `PublicOrder` shape used by the
 * admin panel. The order number itself is high-entropy and unguessable, so
 * possession of it acts as a capability.
 */
export const getPublicOrderByNumber = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await getOrderByNumber(req.params.orderNumber);
    return sendResponse(res, { message: 'Order fetched', data });
  }
);
