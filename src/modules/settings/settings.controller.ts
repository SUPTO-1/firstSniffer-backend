import type { Request, Response } from 'express';
import * as service from './settings.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const getSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const data = await service.getSettings();
  return sendResponse(res, { message: 'Settings fetched', data });
});

export const updateSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const actorId = req.user?.id;
  const data = await service.updateSettings(req.body, actorId);
  return sendResponse(res, { message: 'Settings updated', data });
});
