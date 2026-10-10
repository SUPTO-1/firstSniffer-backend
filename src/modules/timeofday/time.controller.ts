import type { Request, Response } from 'express';
import * as service from './time.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listTimes = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listTimes(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Times fetched', data });
});

export const createTime = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createTime(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Time created', data });
});

export const getTime = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getTimeById(req.params.id);
  return sendResponse(res, { message: 'Time fetched', data });
});

export const updateTime = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateTime(req.params.id, req.body);
  return sendResponse(res, { message: 'Time updated', data });
});

export const removeTime = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteTime(req.params.id);
  return sendResponse(res, { message: 'Time deleted', data });
});
