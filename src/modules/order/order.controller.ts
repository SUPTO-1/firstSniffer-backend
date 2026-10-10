import type { Request, Response } from 'express';
import * as service from './order.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listOrders(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Orders fetched', data });
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getOrderById(req.params.id);
  return sendResponse(res, { message: 'Order fetched', data });
});

export const calculateOrder = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.calculateOrder(req.body);
  return sendResponse(res, { message: 'Order preview calculated', data });
});

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const actorId = (req as unknown as { user?: { id?: string } }).user?.id ?? '';
  const data = await service.createOrder(req.body, actorId);
  return sendResponse(res, { statusCode: 201, message: 'Order created', data });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const actorId = (req as unknown as { user?: { id?: string } }).user?.id ?? '';
  const data = await service.updateOrderStatus(
    req.params.id,
    req.body.orderStatus,
    actorId,
    req.body.reason
  );
  return sendResponse(res, { message: 'Order status updated', data });
});

export const updatePaymentStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.updatePaymentStatus(
      req.params.id,
      req.body.paymentStatus
    );
    return sendResponse(res, { message: 'Payment status updated', data });
  }
);

export const cancelOrder = asyncHandler(async (req: Request, res: Response) => {
  const actorId = (req as unknown as { user?: { id?: string } }).user?.id ?? '';
  const data = await service.cancelOrder(
    req.params.id,
    actorId,
    req.body.reason
  );
  return sendResponse(res, { message: 'Order cancelled', data });
});

export const updateDetails = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateOrderDetails(req.params.id, req.body);
  return sendResponse(res, { message: 'Order updated', data });
});