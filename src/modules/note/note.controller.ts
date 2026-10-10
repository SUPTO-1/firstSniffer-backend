import type { Request, Response } from 'express';
import * as service from './note.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listNotes = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listNotes(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Notes fetched', data });
});

export const createNote = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createNote(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Note created', data });
});

export const getNote = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getNoteById(req.params.id);
  return sendResponse(res, { message: 'Note fetched', data });
});

export const updateNote = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateNote(req.params.id, req.body);
  return sendResponse(res, { message: 'Note updated', data });
});

export const removeNote = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.deleteNote(req.params.id);
  return sendResponse(res, { message: 'Note deleted', data });
});
