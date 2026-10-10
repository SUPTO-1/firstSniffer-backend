import { Brand } from './brand.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type { PublicBrand, BrandDoc, IBrand } from './brand.interface';
import { BRAND_QUERY_CONFIG } from './brand.interface';

export function toPublicBrand(doc: BrandDoc | null): PublicBrand {
  if (!doc) throw ApiError.notFound('Brand not found');
  const raw = doc as unknown as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: raw._id ? String(raw._id) : '',
    name: raw.name as string,
    slug: raw.slug as string,
    logo: raw.logo as string,
    imageFileId: raw.imageFileId as string,
    isFeatured: !!raw.isFeatured,
    isActive: raw.isActive !== false,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

export async function createBrand(input: Partial<IBrand>): Promise<PublicBrand> {
  const doc = await Brand.create(input);
  return toPublicBrand(doc);
}

export function listBrands(
  queryStr: Record<string, unknown>
): Promise<PagedResult<IBrand>> {
  return executePagedQuery<IBrand>(
    Brand as unknown as import('mongoose').Model<IBrand>,
    queryStr,
    BRAND_QUERY_CONFIG
  );
}

export async function getBrandById(id: string): Promise<PublicBrand> {
  const doc = await Brand.findById(id);
  return toPublicBrand(doc);
}

const WRITABLE_BRAND_KEYS = [
  'name',
  'slug',
  'logo',
  'imageFileId',
  'isFeatured',
  'isActive',
] as const;

export async function updateBrand(
  id: string,
  input: Partial<IBrand>
): Promise<PublicBrand> {
  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_BRAND_KEYS
  );
  const doc = await Brand.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Brand not found');
  return toPublicBrand(doc);
}

export async function deleteBrand(id: string): Promise<PublicBrand> {
  const doc = await Brand.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Brand not found');
  const publicDoc = toPublicBrand(doc);
  if (doc.imageFileId) void deleteImageKitFile(doc.imageFileId);
  return publicDoc;
}