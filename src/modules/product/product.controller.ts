import type { Request, Response } from 'express';
import * as service from './product.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listProducts(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Products fetched', data });
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createProduct(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Product created', data });
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getProductById(req.params.id);
  return sendResponse(res, { message: 'Product fetched', data });
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateProduct(req.params.id, req.body);
  return sendResponse(res, { message: 'Product updated', data });
});

export const removeProduct = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteProduct(req.params.id);
  return sendResponse(res, { message: 'Product deleted', data });
});

export const restoreProduct = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.restoreProduct(req.params.id);
  return sendResponse(res, { message: 'Product restored', data });
});

export const updateProductImages = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateProductImages(req.params.id, req.body);
  return sendResponse(res, { message: 'Product images updated', data });
});
