import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export interface INote {
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type NoteDoc = INote & Document & { _id: unknown };

export interface PublicNote {
  id: string;
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const NOTE_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: { isActive: 'boolean' },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
