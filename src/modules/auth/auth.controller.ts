import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as service from './auth.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { clearAuthCookie, setAuthCookie } from '../../config/cookie';
import { ApiError } from '../../utils/ApiError';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.register(req.body);
  setAuthCookie(res, result.token);
  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Account created',
    data: result.user,
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.login(req.body);
  setAuthCookie(res, result.token);
  return sendResponse(res, {
    message: 'Login successful',
    data: result.user,
  });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  return sendResponse(res, { message: 'Logged out', data: null });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) throw ApiError.unauthorized();
  const user = await service.getCurrentUser(req.user.id);
  return sendResponse(res, { message: 'Authenticated', data: user });
});