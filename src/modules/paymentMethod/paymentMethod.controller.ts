import type { Request, Response } from 'express';
import * as service from './paymentMethod.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listPaymentMethods = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.listPaymentMethods(req.query as Record<string, unknown>);
    return sendResponse(res, { message: 'Payment methods fetched', data });
  }
);

export const listActivePaymentMethods = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await service.listActivePaymentMethods();
    return sendResponse(res, { message: 'Active payment methods fetched', data });
  }
);

export const createPaymentMethod = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.createPaymentMethod(req.body);
    return sendResponse(res, { statusCode: 201, message: 'Payment method created', data });
  }
);

export const getPaymentMethod = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.getPaymentMethodById(req.params.id);
    return sendResponse(res, { message: 'Payment method fetched', data });
  }
);

export const updatePaymentMethod = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.updatePaymentMethod(req.params.id, req.body);
    return sendResponse(res, { message: 'Payment method updated', data });
  }
);

export const removePaymentMethod = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.deletePaymentMethod(req.params.id);
    return sendResponse(res, { message: 'Payment method deleted', data });
  }
);

export const toggleActive = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.togglePaymentMethodActive(
    req.params.id,
    req.body.isActive
  );
  return sendResponse(res, { message: 'Payment method updated', data });
});
