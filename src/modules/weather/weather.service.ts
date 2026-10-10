import { Weather } from './weather.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type { PublicWeather, WeatherDoc, IWeather } from './weather.interface';
import { WEATHER_QUERY_CONFIG } from './weather.interface';

export function toPublicWeather(doc: WeatherDoc | null): PublicWeather {
  if (!doc) throw ApiError.notFound('Weather not found');
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

export async function createWeather(input: Partial<IWeather>): Promise<PublicWeather> {
  const doc = await Weather.create(input);
  return toPublicWeather(doc);
}

export function listWeathers(
  queryStr: Record<string, unknown>
): Promise<PagedResult<IWeather>> {
  return executePagedQuery<IWeather>(
    Weather as unknown as import('mongoose').Model<IWeather>,
    queryStr,
    WEATHER_QUERY_CONFIG
  );
}

export async function getWeatherById(id: string): Promise<PublicWeather> {
  const doc = await Weather.findById(id);
  return toPublicWeather(doc);
}

const WRITABLE_WEATHER_KEYS = [
  'name',
  'slug',
  'image',
  'imageFileId',
  'isActive',
] as const;

export async function updateWeather(
  id: string,
  input: Partial<IWeather>
): Promise<PublicWeather> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_WEATHER_KEYS
  );
  const doc = await Weather.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Weather not found');
  return toPublicWeather(doc);
}

export async function deleteWeather(id: string): Promise<PublicWeather> {
  const doc = await Weather.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Weather not found');
  const publicDoc = toPublicWeather(doc);
  if (doc.imageFileId) void deleteImageKitFile(doc.imageFileId);
  return publicDoc;
}