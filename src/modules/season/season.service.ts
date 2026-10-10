import { Season } from './season.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type { PublicSeason, SeasonDoc, ISeason } from './season.interface';
import { SEASON_QUERY_CONFIG } from './season.interface';

export function toPublicSeason(doc: SeasonDoc | null): PublicSeason {
  if (!doc) throw ApiError.notFound('Season not found');
  const raw = doc as unknown as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: raw._id ? String(raw._id) : '',
    name: raw.name as string,
    slug: raw.slug as string,
    image: raw.image as string,
    imageFileId: raw.imageFileId as string,
    isActive: raw.isActive !== false,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

export async function createSeason(input: Partial<ISeason>): Promise<PublicSeason> {
  const doc = await Season.create(input);
  return toPublicSeason(doc);
}

export function listSeasons(
  queryStr: Record<string, unknown>
): Promise<PagedResult<ISeason>> {
  return executePagedQuery<ISeason>(
    Season as unknown as import('mongoose').Model<ISeason>,
    queryStr,
    SEASON_QUERY_CONFIG
  );
}

export async function getSeasonById(id: string): Promise<PublicSeason> {
  const doc = await Season.findById(id);
  return toPublicSeason(doc);
}

const WRITABLE_SEASON_KEYS = [
  'name',
  'slug',
  'image',
  'imageFileId',
  'isActive',
] as const;

export async function updateSeason(
  id: string,
  input: Partial<ISeason>
): Promise<PublicSeason> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_SEASON_KEYS
  );
  const doc = await Season.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Season not found');
  return toPublicSeason(doc);
}

export async function deleteSeason(id: string): Promise<PublicSeason> {
  const doc = await Season.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Season not found');
  const publicDoc = toPublicSeason(doc);
  if (doc.imageFileId) void deleteImageKitFile(doc.imageFileId);
  return publicDoc;
}