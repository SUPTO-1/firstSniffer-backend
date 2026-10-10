import { Atomizer } from './atomizer.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type {
  PublicAtomizer,
  AtomizerDoc,
  IAtomizer,
  IAtomizerSize,
} from './atomizer.interface';
import { ATOMIZER_QUERY_CONFIG } from './atomizer.interface';

function normalizeSizes(input: unknown): IAtomizerSize[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      size: String(s.size ?? '').trim(),
      additionalPrice: Number(s.additionalPrice ?? 0),
    }))
    .filter((s) => s.size.length > 0);
}

export function toPublicAtomizer(doc: AtomizerDoc | null): PublicAtomizer {
  if (!doc) throw ApiError.notFound('Atomizer not found');
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
    sizes: normalizeSizes(raw.sizes),
    isActive: raw.isActive !== false,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

export async function createAtomizer(input: Partial<IAtomizer>): Promise<PublicAtomizer> {
  const doc = await Atomizer.create(input);
  return toPublicAtomizer(doc);
}

export function listAtomizers(
  queryStr: Record<string, unknown>
): Promise<PagedResult<IAtomizer>> {
  return executePagedQuery<IAtomizer>(
    Atomizer as unknown as import('mongoose').Model<IAtomizer>,
    queryStr,
    ATOMIZER_QUERY_CONFIG
  );
}

export async function getAtomizerById(id: string): Promise<PublicAtomizer> {
  const doc = await Atomizer.findById(id);
  return toPublicAtomizer(doc);
}

const WRITABLE_ATOMIZER_KEYS = [
  'name',
  'slug',
  'image',
  'imageFileId',
  'sizes',
  'isActive',
] as const;

export async function updateAtomizer(
  id: string,
  input: Partial<IAtomizer>
): Promise<PublicAtomizer> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_ATOMIZER_KEYS
  );
  const doc = await Atomizer.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Atomizer not found');
  return toPublicAtomizer(doc);
}

export async function deleteAtomizer(id: string): Promise<PublicAtomizer> {
  const doc = await Atomizer.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Atomizer not found');
  const publicDoc = toPublicAtomizer(doc);
  if (doc.imageFileId) void deleteImageKitFile(doc.imageFileId);
  return publicDoc;
}