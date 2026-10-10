import type { Request, Response } from 'express';
import * as service from './inventory.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listInventory = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listInventory(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Inventory fetched', data });
});

export const getInventory = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getInventoryById(req.params.id);
  return sendResponse(res, { message: 'Inventory fetched', data });
});

export const createInventory = asyncHandler(async (req: Request, res: Response) => {
  const actorId = req.user?.id;
  const data = await service.createInventory({ ...req.body, actorId });
  return sendResponse(res, { statusCode: 201, message: 'Inventory created', data });
});

export const updateInventory = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateInventory(req.params.id, req.body);
  return sendResponse(res, { message: 'Inventory updated', data });
});

export const deleteInventory = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteInventory(req.params.id);
  return sendResponse(res, { message: 'Inventory deleted', data });
});

export const adjustInventory = asyncHandler(async (req: Request, res: Response) => {
  const actorId = req.user?.id;
  const data = await service.adjustInventoryMl(
    req.params.id,
    req.body.deltaMl,
    req.body.note ?? '',
    actorId
  );
  return sendResponse(res, { message: 'Inventory adjusted', data });
});

export const releaseBuffer = asyncHandler(async (req: Request, res: Response) => {
  const actorId = req.user?.id;
  const data = await service.releaseBufferMl(
    req.params.id,
    req.body.quantityMl,
    req.body.note ?? '',
    actorId
  );
  return sendResponse(res, { message: 'Buffer released', data });
});

export const recordSale = asyncHandler(async (req: Request, res: Response) => {
  const actorId = req.user?.id;
  const data = await service.recordSaleMl(
    req.params.id,
    req.body.quantityMl,
    req.body.referenceId,
    req.body.note ?? '',
    actorId
  );
  return sendResponse(res, { message: 'Sale recorded', data });
});