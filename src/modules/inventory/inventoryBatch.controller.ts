import type { Request, Response } from 'express';
import * as service from './inventoryBatch.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listInventoryBatches = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.listInventoryBatches(
      req.query as Record<string, unknown>
    );
    return sendResponse(res, { message: 'Inventory batches fetched', data });
  }
);

export const getInventoryBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.getInventoryBatchById(req.params.id);
    return sendResponse(res, { message: 'Inventory batch fetched', data });
  }
);

export const createInventoryBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const actorId = req.user?.id;
    const data = await service.createInventoryBatch({ ...req.body, actorId });
    return sendResponse(res, {
      statusCode: 201,
      message: 'Inventory batch created',
      data,
    });
  }
);

export const updateInventoryBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.updateInventoryBatch(req.params.id, req.body);
    return sendResponse(res, { message: 'Inventory batch updated', data });
  }
);

export const retireInventoryBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const actorId = req.user?.id;
    const data = await service.retireInventoryBatch(req.params.id, actorId);
    return sendResponse(res, { message: 'Inventory batch retired', data });
  }
);

export const adjustInventoryBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const actorId = req.user?.id;
    const data = await service.adjustBatchMl(
      req.params.id,
      req.body.deltaMl,
      req.body.note ?? '',
      actorId
    );
    return sendResponse(res, { message: 'Inventory batch adjusted', data });
  }
);

export const restockInventoryBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const actorId = req.user?.id;
    const data = await service.restockBatchMl(
      req.params.id,
      req.body.quantityMl,
      req.body.note ?? '',
      actorId
    );
    return sendResponse(res, { message: 'Inventory batch restocked', data });
  }
);

export const getProductStock = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.getProductStock(req.params.productId);
    return sendResponse(res, { message: 'Product stock fetched', data });
  }
);
