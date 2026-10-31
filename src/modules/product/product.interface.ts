import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';
import type { PublicBrand } from '../brand/brand.interface';
import type { PublicGenre } from '../genre/genre.interface';
import type { PublicNote } from '../note/note.interface';
import type { PublicSeason } from '../season/season.interface';
import type { PublicOccasion } from '../occasion/occasion.interface';
import type { PublicWeather } from '../weather/weather.interface';
import type { PublicTime } from '../timeofday/time.interface';
import type { PublicAtomizer } from '../atomizer/atomizer.interface';

export type ProductSize = '3ml' | '5ml' | '10ml' | '15ml' | '30ml';

export interface IProductImage {
  url: string;
  fileId: string;
  alt?: string;
}

export interface IProductVariant {
  size: ProductSize;
  price: number;
  /** Admin toggle for the selling size. Defaults to true. */
  isActive: boolean;
}

export interface IProductPerformance {
  longevity: 'low' | 'moderate' | 'long-lasting' | 'eternal';
  projection: 'soft' | 'moderate' | 'strong' | 'beast-mode';
  versatility: 'niche' | 'moderate' | 'versatile';
}

export interface IProductNotes {
  top: Types.ObjectId[];
  middle: Types.ObjectId[];
  base: Types.ObjectId[];
}

export interface IProduct {
  name: string;
  slug: string;
  // ObjectId fields are typed as the raw Mongoose type so the typed Schema
  // accepts `type: Schema.Types.ObjectId, ref: 'Brand'` without a type fight.
  // The service layer stringifies them through `.toString()` when needed.
  brand: Types.ObjectId;
  genres: Types.ObjectId[];
  description: string;
  notes: IProductNotes;
  gender: 'masculine' | 'feminine' | 'unisex';
  seasons: Types.ObjectId[];
  occasions: Types.ObjectId[];
  weathers: Types.ObjectId[];
  times: Types.ObjectId[];
  performance: IProductPerformance;
  images: IProductImage[];
  variants: IProductVariant[];
  defaultAtomizer?: Types.ObjectId;
  aliases: string[];
  /** Seller-held margin (ml) kept back from sale. Enforced, not advisory. */
  safetyBufferMl: number;
  /** Warn when sellable stock falls to or below this (ml). */
  lowStockThresholdMl: number;
  averageRating: number;
  reviewCount: number;
  featured: boolean;
  bestSelling: boolean;
  topRated: boolean;
  newArrival: boolean;
  isActive: boolean;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ProductDoc = IProduct & Document & { _id: unknown };

/**
 * Public-facing shape. The `brand` field is a populated `PublicBrand` doc
 * (NOT a raw ObjectId) so the admin table can render the logo + name
 * without an extra round-trip. The same applies to every other `ref:`
 * field below.
 */
export interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  brand: PublicBrand | null;
  genres: PublicGenre[];
  description: string;
  notes: { top: PublicNote[]; middle: PublicNote[]; base: PublicNote[] };
  gender: IProduct['gender'];
  seasons: PublicSeason[];
  occasions: PublicOccasion[];
  weathers: PublicWeather[];
  times: PublicTime[];
  performance: IProductPerformance;
  images: IProductImage[];
  variants: IProductVariant[];
  defaultAtomizer: PublicAtomizer | null;
  aliases: string[];
  averageRating: number;
  reviewCount: number;
  featured: boolean;
  bestSelling: boolean;
  topRated: boolean;
  newArrival: boolean;
  isActive: boolean;
  deletedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  /**
   * Product-level stock summary. Present on PUBLIC payloads only — the
   * stock is a single shared ml pool per product, and every selling size
   * draws from it.
   */
  stock?: {
    /** Physical capacity on hand across all purchase batches. */
    totalMl: number;
    /** What a customer can actually buy: remaining minus the safety buffer. */
    sellableMl: number;
    status: 'in_stock' | 'low_stock' | 'out_of_stock';
  };
}

export const PRODUCT_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug', 'aliases'],
  // `aliases` is an array of strings — search with $in regex so any element
  // match counts.
  searchArrayFields: ['aliases'],
  allowedFilters: {
    brand: 'objectId',
    gender: 'enum:masculine,feminine,unisex',
    isActive: 'boolean',
    featured: 'boolean',
    bestSelling: 'boolean',
    topRated: 'boolean',
    newArrival: 'boolean',
    seasons: 'csv',
    occasions: 'csv',
    weathers: 'csv',
    times: 'csv',
    genres: 'csv',
    'notes.top': 'csv',
    'notes.middle': 'csv',
    'notes.base': 'csv',
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
