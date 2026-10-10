import type { Request, Response } from 'express';
import { Genre } from '../genre/genre.model';
import { Note } from '../note/note.model';
import { Season } from '../season/season.model';
import { Occasion } from '../occasion/occasion.model';
import { Weather } from '../weather/weather.model';
import { Time } from '../timeofday/time.model';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { toPublicGenre } from '../genre/genre.service';
import { toPublicNote } from '../note/note.service';
import { toPublicSeason } from '../season/season.service';
import { toPublicOccasion } from '../occasion/occasion.service';
import { toPublicWeather } from '../weather/weather.service';
import { toPublicTime } from '../timeofday/time.service';

/**
 * Catalog endpoints for landing-page filter chips: genres, notes (top/middle/
 * base), seasons, occasions, weathers, times. Each returns the public shape
 * for the corresponding master-data module. No auth — public storefront.
 *
 * Each handler filters `isActive: true` and sorts by name ascending.
 */

function sortByName<T extends { name?: string }>(arr: T[]): T[] {
  return arr.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

export const listPublicGenres = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Genre.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicGenre(r as never)));
  return sendResponse(res, { message: 'Genres fetched', data: results });
});

export const listPublicNotes = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Note.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicNote(r as never)));
  return sendResponse(res, { message: 'Notes fetched', data: results });
});

export const listPublicSeasons = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Season.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicSeason(r as never)));
  return sendResponse(res, { message: 'Seasons fetched', data: results });
});

export const listPublicOccasions = asyncHandler(
  async (_req: Request, res: Response) => {
    const rows = await Occasion.find({ isActive: true }).lean().exec();
    const results = sortByName(rows.map((r) => toPublicOccasion(r as never)));
    return sendResponse(res, { message: 'Occasions fetched', data: results });
  }
);

export const listPublicWeathers = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Weather.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicWeather(r as never)));
  return sendResponse(res, { message: 'Weathers fetched', data: results });
});

export const listPublicTimes = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Time.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicTime(r as never)));
  return sendResponse(res, { message: 'Times fetched', data: results });
});