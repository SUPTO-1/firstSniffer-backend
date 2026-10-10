import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export interface IGenre {
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type GenreDoc = IGenre & Document & { _id: unknown };

export interface PublicGenre {
  id: string;
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const GENRE_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: { isActive: 'boolean' },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
