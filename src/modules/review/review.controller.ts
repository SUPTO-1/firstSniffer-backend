import type { Request, Response } from 'express';
import * as service from './review.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listReviews = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listReviews(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Reviews fetched', data });
});

export const getReview = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getReviewById(req.params.id);
  return sendResponse(res, { message: 'Review fetched', data });
});

export const createReview = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createReview(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Review created', data });
});

export const updateReview = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateReview(req.params.id, req.body);
  return sendResponse(res, { message: 'Review updated', data });
});

export const removeReview = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteReview(req.params.id);
  return sendResponse(res, { message: 'Review deleted', data });
});

export const approveReview = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.approveReview(req.params.id);
  return sendResponse(res, { message: 'Review approved', data });
});

export const rejectReview = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.rejectReview(req.params.id);
  return sendResponse(res, { message: 'Review rejected', data });
});