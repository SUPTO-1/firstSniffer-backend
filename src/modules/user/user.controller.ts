import type { Request, Response } from 'express';
import * as service from './user.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';

function getUserId(req: Request): string {
  if (!req.user?.id) throw ApiError.unauthorized();
  return req.user.id;
}

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getProfileById(getUserId(req));
  return sendResponse(res, { message: 'Profile fetched', data });
});

export const patchProfile = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateProfile(getUserId(req), req.body);
  return sendResponse(res, { message: 'Profile updated', data });
});

export const postAddress = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.addAddress(getUserId(req), req.body);
  return sendResponse(res, { statusCode: 201, message: 'Address added', data });
});

export const patchAddress = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateAddress(
    getUserId(req),
    req.params.addressId,
    req.body
  );
  return sendResponse(res, { message: 'Address updated', data });
});

export const putDefaultAddress = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.setDefaultAddress(
    getUserId(req),
    req.params.addressId
  );
  return sendResponse(res, { message: 'Default address updated', data });
});

export const removeAddress = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteAddress(
    getUserId(req),
    req.params.addressId
  );
  return sendResponse(res, { message: 'Address removed', data });
});