import { Genre } from './genre.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type { PublicGenre, GenreDoc, IGenre } from './genre.interface';
import { GENRE_QUERY_CONFIG } from './genre.interface';

export function toPublicGenre(doc: GenreDoc | null): PublicGenre {
  if (!doc) throw ApiError.notFound('Genre not found');
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

export async function createGenre(input: Partial<IGenre>): Promise<PublicGenre> {
  const doc = await Genre.create(input);
  return toPublicGenre(doc);
}

export function listGenres(
  queryStr: Record<string, unknown>
): Promise<PagedResult<IGenre>> {
  return executePagedQuery<IGenre>(
    Genre as unknown as import('mongoose').Model<IGenre>,
    queryStr,
    GENRE_QUERY_CONFIG
  );
}

export async function getGenreById(id: string): Promise<PublicGenre> {
  const doc = await Genre.findById(id);
  return toPublicGenre(doc);
}

const WRITABLE_GENRE_KEYS = [
  'name',
  'slug',
  'image',
  'imageFileId',
  'isActive',
] as const;

export async function updateGenre(
  id: string,
  input: Partial<IGenre>
): Promise<PublicGenre> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_GENRE_KEYS
  );
  const doc = await Genre.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Genre not found');
  return toPublicGenre(doc);
}

export async function deleteGenre(id: string): Promise<PublicGenre> {
  const doc = await Genre.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Genre not found');
  const publicDoc = toPublicGenre(doc);
  if (doc.imageFileId) void deleteImageKitFile(doc.imageFileId);
  return publicDoc;
}