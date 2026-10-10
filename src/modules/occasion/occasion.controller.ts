import type { Request, Response } from 'express';
import * as service from './occasion.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listOccasions = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listOccasions(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Occasions fetched', data });
});

export const createOccasion = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createOccasion(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Occasion created', data });
});

export const getOccasion = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getOccasionById(req.params.id);
  return sendResponse(res, { message: 'Occasion fetched', data });
});

export const updateOccasion = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateOccasion(req.params.id, req.body);
  return sendResponse(res, { message: 'Occasion updated', data });
});

export const removeOccasion = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteOccasion(req.params.id);
  return sendResponse(res, { message: 'Occasion deleted', data });
});
