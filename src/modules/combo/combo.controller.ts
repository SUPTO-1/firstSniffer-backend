import type { Request, Response } from 'express';
import * as service from './combo.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listCombos = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listCombos(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Combos fetched', data });
});

export const getCombo = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getComboById(req.params.id);
  return sendResponse(res, { message: 'Combo fetched', data });
});

export const createCombo = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createCombo(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Combo created', data });
});

export const updateCombo = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateCombo(req.params.id, req.body);
  return sendResponse(res, { message: 'Combo updated', data });
});

export const removeCombo = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteCombo(req.params.id);
  return sendResponse(res, { message: 'Combo deleted', data });
});

export const toggleActive = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.toggleComboActive(req.params.id, req.body.isActive);
  return sendResponse(res, { message: 'Combo updated', data });
});