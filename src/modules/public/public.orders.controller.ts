import type { Request, Response } from 'express';
import {
  getOrderByNumber,
  getOrderDocByNumber,
  getOrderByToken,
  getOrderDocByToken,
} from '../order/order.service';
import { streamInvoice } from '../order/invoice.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';

/**
 * GET /api/public/orders/track/:token
 *
 * Public storefront lookup by SECURE token. This is the route the
 * order-confirmation page uses — the token is the capability, and unlike
 * the sequential order number it cannot be guessed.
 */
export const getPublicOrderByToken = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await getOrderByToken(req.params.token);
    return sendResponse(res, { message: 'Order fetched', data });
  }
);

/**
 * GET /api/public/orders/track/:token/invoice
 *
 * Public PDF download by secure token. No payments log (admin-only).
 */
export const getPublicInvoiceByToken = asyncHandler(
  async (req: Request, res: Response) => {
    const order = await getOrderDocByToken(req.params.token);
    await streamInvoice(
      res,
      order as unknown as Parameters<typeof streamInvoice>[1],
      { includePaymentsLog: false }
    );
  }
);

/**
 * GET /api/public/orders/:orderNumber
 *
 * Public storefront lookup by human-readable order number (e.g.
 * `FS-2026-000001`).
 *
 * SECURITY: the order number is SEQUENTIAL, so this route alone would
 * let anyone enumerate the shop's order history. Orders that have a
 * `publicToken` are therefore NOT served here — callers must use the
 * token route. This keeps existing links working for orders created
 * before tokens existed, without leaving a wide-open enumeration hole.
 */
export const getPublicOrderByNumber = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await getOrderByNumber(req.params.orderNumber);
    if (data.publicToken) {
      throw ApiError.notFound('Order not found');
    }
    return sendResponse(res, { message: 'Order fetched', data });
  }
);

/**
 * GET /api/public/orders/:orderNumber/invoice
 *
 * Public PDF download for the storefront success page. The same
 * order-number capability model applies. We deliberately do not include
 * the payments log (admin-only) and we surface a 404 (not a
 * 200-with-empty-PDF) for unknown orderNumbers to avoid leaking an
 * oracle.
 */
export const getPublicInvoiceByNumber = asyncHandler(
  async (req: Request, res: Response) => {
    const order = await getOrderDocByNumber(req.params.orderNumber);
    if (order.publicToken) {
      throw ApiError.notFound('Order not found');
    }
    await streamInvoice(
      res,
      order as unknown as Parameters<typeof streamInvoice>[1],
      { includePaymentsLog: false }
    );
  }
);
