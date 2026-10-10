import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendResponse } from '../../utils/sendResponse';
import { getImageKitAuth } from './imagekit.service';

export const getAuthParams = asyncHandler(
  async (_req: Request, res: Response) => {
    const triplet = getImageKitAuth();
    return sendResponse(res, {
      message: 'ImageKit auth',
      data: {
        token: triplet.token,
        expire: triplet.expire,
        signature: triplet.signature,
        publicKey: triplet.publicKey,
      },
    });
  }
);