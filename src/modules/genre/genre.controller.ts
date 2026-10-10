import type { Request, Response } from 'express';
import * as service from './genre.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listGenres = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listGenres(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Genres fetched', data });
});

export const createGenre = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createGenre(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Genre created', data });
});

export const getGenre = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getGenreById(req.params.id);
  return sendResponse(res, { message: 'Genre fetched', data });
});

export const updateGenre = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateGenre(req.params.id, req.body);
  return sendResponse(res, { message: 'Genre updated', data });
});

export const removeGenre = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteGenre(req.params.id);
  return sendResponse(res, { message: 'Genre deleted', data });
});
