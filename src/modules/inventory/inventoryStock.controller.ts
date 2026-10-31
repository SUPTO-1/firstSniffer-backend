import type { Request, Response } from 'express';
import * as service from './inventoryStock.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listProductStock = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.listProductStock(
      req.query as Record<string, unknown>
    );
    return sendResponse(res, { message: 'Product stock fetched', data });
  }
);

export const getProductStock = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.getInventorySettings(req.params.productId);
    return sendResponse(res, { message: 'Product stock fetched', data });
  }
);

export const updateProductStock = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.updateInventorySettings(
      req.params.productId,
      req.body
    );
    return sendResponse(res, { message: 'Product stock updated', data });
  }
);
