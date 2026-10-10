import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export interface IAtomizerSize {
  size: string;
  additionalPrice: number;
}

export interface IAtomizer {
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  sizes: IAtomizerSize[];
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type AtomizerDoc = IAtomizer & Document & { _id: unknown };

export interface PublicAtomizer {
  id: string;
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  sizes: IAtomizerSize[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const ATOMIZER_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: { isActive: 'boolean' },
  defaultSort: '-createdAt',
  maxLimit: 100,
};