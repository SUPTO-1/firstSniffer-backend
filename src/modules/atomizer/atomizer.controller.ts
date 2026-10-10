import type { Request, Response } from 'express';
import * as service from './atomizer.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listAtomizers = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listAtomizers(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Atomizers fetched', data });
});

export const createAtomizer = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createAtomizer(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Atomizer created', data });
});

export const getAtomizer = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getAtomizerById(req.params.id);
  return sendResponse(res, { message: 'Atomizer fetched', data });
});

export const updateAtomizer = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateAtomizer(req.params.id, req.body);
  return sendResponse(res, { message: 'Atomizer updated', data });
});

export const removeAtomizer = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteAtomizer(req.params.id);
  return sendResponse(res, { message: 'Atomizer deleted', data });
});