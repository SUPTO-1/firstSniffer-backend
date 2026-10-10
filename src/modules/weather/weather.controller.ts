import type { Request, Response } from 'express';
import * as service from './weather.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listWeathers = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listWeathers(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Weathers fetched', data });
});

export const createWeather = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createWeather(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Weather created', data });
});

export const getWeather = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getWeatherById(req.params.id);
  return sendResponse(res, { message: 'Weather fetched', data });
});

export const updateWeather = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateWeather(req.params.id, req.body);
  return sendResponse(res, { message: 'Weather updated', data });
});

export const removeWeather = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteWeather(req.params.id);
  return sendResponse(res, { message: 'Weather deleted', data });
});
