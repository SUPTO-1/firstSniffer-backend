import type { Request, Response } from 'express';
import { getOrderByNumber, getOrderDocByNumber } from '../order/order.service';
import { streamInvoice } from '../order/invoice.service';
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

/**
 * GET /api/public/orders/:orderNumber/invoice
 *
 * Public PDF download for the storefront success page. The same order-number
 * capability model applies. We deliberately do not include the payments log
 * (admin-only) and we surface a 404 (not a 200-with-empty-PDF) for unknown
 * orderNumbers to avoid leaking an oracle.
 */
export const getPublicInvoiceByNumber = asyncHandler(
  async (req: Request, res: Response) => {
    const order = await getOrderDocByNumber(req.params.orderNumber);
    await streamInvoice(
      res,
      order as unknown as Parameters<typeof streamInvoice>[1],
      { includePaymentsLog: false }
    );
  }
);
