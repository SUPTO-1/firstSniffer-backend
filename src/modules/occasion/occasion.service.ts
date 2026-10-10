import { Occasion } from './occasion.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type { PublicOccasion, OccasionDoc, IOccasion } from './occasion.interface';
import { OCCASION_QUERY_CONFIG } from './occasion.interface';

export function toPublicOccasion(doc: OccasionDoc | null): PublicOccasion {
  if (!doc) throw ApiError.notFound('Occasion not found');
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

export async function createOccasion(input: Partial<IOccasion>): Promise<PublicOccasion> {
  const doc = await Occasion.create(input);
  return toPublicOccasion(doc);
}

export function listOccasions(
  queryStr: Record<string, unknown>
): Promise<PagedResult<IOccasion>> {
  return executePagedQuery<IOccasion>(
    Occasion as unknown as import('mongoose').Model<IOccasion>,
    queryStr,
    OCCASION_QUERY_CONFIG
  );
}

export async function getOccasionById(id: string): Promise<PublicOccasion> {
  const doc = await Occasion.findById(id);
  return toPublicOccasion(doc);
}

const WRITABLE_OCCASION_KEYS = [
  'name',
  'slug',
  'image',
  'imageFileId',
  'isActive',
] as const;

export async function updateOccasion(
  id: string,
  input: Partial<IOccasion>
): Promise<PublicOccasion> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_OCCASION_KEYS
  );
  const doc = await Occasion.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Occasion not found');
  return toPublicOccasion(doc);
}

export async function deleteOccasion(id: string): Promise<PublicOccasion> {
  const doc = await Occasion.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Occasion not found');
  const publicDoc = toPublicOccasion(doc);
  if (doc.imageFileId) void deleteImageKitFile(doc.imageFileId);
  return publicDoc;
}