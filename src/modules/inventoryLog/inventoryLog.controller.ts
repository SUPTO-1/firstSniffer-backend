import type { Request, Response } from 'express';
import * as service from './inventoryLog.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listInventoryLogs = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.listInventoryLogs(
      req.query as Record<string, unknown>
    );
    return sendResponse(res, { message: 'Inventory logs fetched', data });
  }
);