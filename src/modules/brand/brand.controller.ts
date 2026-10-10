import type { Request, Response } from 'express';
import * as service from './brand.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listBrands = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listBrands(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Brands fetched', data });
});

export const createBrand = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createBrand(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Brand created', data });
});

export const getBrand = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getBrandById(req.params.id);
  return sendResponse(res, { message: 'Brand fetched', data });
});

export const updateBrand = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateBrand(req.params.id, req.body);
  return sendResponse(res, { message: 'Brand updated', data });
});

export const removeBrand = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteBrand(req.params.id);
  return sendResponse(res, { message: 'Brand deleted', data });
});
