import { Time } from './time.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type { PublicTime, TimeDoc, ITime } from './time.interface';
import { TIME_QUERY_CONFIG } from './time.interface';

export function toPublicTime(doc: TimeDoc | null): PublicTime {
  if (!doc) throw ApiError.notFound('Time not found');
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

export async function createTime(input: Partial<ITime>): Promise<PublicTime> {
  const doc = await Time.create(input);
  return toPublicTime(doc);
}

export function listTimes(
  queryStr: Record<string, unknown>
): Promise<PagedResult<ITime>> {
  return executePagedQuery<ITime>(
    Time as unknown as import('mongoose').Model<ITime>,
    queryStr,
    TIME_QUERY_CONFIG
  );
}

export async function getTimeById(id: string): Promise<PublicTime> {
  const doc = await Time.findById(id);
  return toPublicTime(doc);
}

const WRITABLE_TIME_KEYS = [
  'name',
  'slug',
  'image',
  'imageFileId',
  'isActive',
] as const;

export async function updateTime(
  id: string,
  input: Partial<ITime>
): Promise<PublicTime> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_TIME_KEYS
  );
  const doc = await Time.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Time not found');
  return toPublicTime(doc);
}

export async function deleteTime(id: string): Promise<PublicTime> {
  const doc = await Time.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Time not found');
  const publicDoc = toPublicTime(doc);
  if (doc.imageFileId) void deleteImageKitFile(doc.imageFileId);
  return publicDoc;
}