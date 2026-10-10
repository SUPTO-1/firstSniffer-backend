import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export interface ITime {
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TimeDoc = ITime & Document & { _id: unknown };

export interface PublicTime {
  id: string;
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const TIME_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: { isActive: 'boolean' },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
