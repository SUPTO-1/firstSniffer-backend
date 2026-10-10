import type { Request, Response } from 'express';
import * as service from './season.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listSeasons = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listSeasons(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Seasons fetched', data });
});
export const createSeason = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createSeason(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Season created', data });
});
export const getSeason = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getSeasonById(req.params.id);
  return sendResponse(res, { message: 'Season fetched', data });
});
export const updateSeason = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateSeason(req.params.id, req.body);
  return sendResponse(res, { message: 'Season updated', data });
});
export const removeSeason = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteSeason(req.params.id);
  return sendResponse(res, { message: 'Season deleted', data });
});
