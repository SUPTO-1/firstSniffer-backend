import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export interface IOccasion {
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OccasionDoc = IOccasion & Document & { _id: unknown };

export interface PublicOccasion {
  id: string;
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const OCCASION_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: { isActive: 'boolean' },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
