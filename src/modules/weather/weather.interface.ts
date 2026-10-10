import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export interface IWeather {
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type WeatherDoc = IWeather & Document & { _id: unknown };

export interface PublicWeather {
  id: string;
  name: string;
  slug: string;
  image: string;
  imageFileId: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const WEATHER_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: { isActive: 'boolean' },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
