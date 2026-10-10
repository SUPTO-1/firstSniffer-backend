import type { Request, Response } from 'express';
import * as service from './coupon.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listCoupons = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listCoupons(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Coupons fetched', data });
});

export const validateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const code = String(req.query.code ?? '');
  const subtotal = Number(req.query.subtotal ?? 0);
  const data = await service.validateCoupon(code, subtotal);
  return sendResponse(res, { message: 'Coupon validated', data });
});

export const getCoupon = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getCouponById(req.params.id);
  return sendResponse(res, { message: 'Coupon fetched', data });
});

export const createCoupon = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createCoupon(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Coupon created', data });
});

export const updateCoupon = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateCoupon(req.params.id, req.body);
  return sendResponse(res, { message: 'Coupon updated', data });
});

export const removeCoupon = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteCoupon(req.params.id);
  return sendResponse(res, { message: 'Coupon deleted', data });
});

export const toggleActive = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.toggleCouponActive(req.params.id, req.body.isActive);
  return sendResponse(res, { message: 'Coupon updated', data });
});