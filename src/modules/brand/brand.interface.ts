import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export interface IBrand {
  name: string;
  slug: string;
  /** ImageKit image URL — never raw binary in Mongo. */
  logo: string;
  /** ImageKit file ID — used to call `imagekit.deleteFile` on remove. */
  imageFileId: string;
  isFeatured: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type BrandDoc = IBrand & Document & { _id: unknown };

export interface PublicBrand {
  id: string;
  name: string;
  slug: string;
  logo: string;
  imageFileId: string;
  isFeatured: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Whitelist consumed by `executePagedQuery`. */
export const BRAND_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: {
    isActive: 'boolean',
    isFeatured: 'boolean',
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
