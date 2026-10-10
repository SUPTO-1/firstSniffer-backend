import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface IReview {
  product: Types.ObjectId;
  customer: Types.ObjectId;
  rating: number;
  title: string;
  comment: string;
  images: { url: string; fileId: string }[];
  status: ReviewStatus;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ReviewDoc = IReview & Document & { _id: unknown };

export interface PublicReview {
  id: string;
  product: { id: string; name: string; slug: string };
  customer: { id: string; name: string };
  rating: number;
  title: string;
  comment: string;
  images: { url: string; fileId: string }[];
  status: ReviewStatus;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const REVIEW_QUERY_CONFIG: QueryConfig = {
  searchFields: ['title', 'comment'],
  allowedFilters: {
    status: 'enum:pending,approved,rejected',
    rating: 'number',
    product: 'objectId',
    customer: 'objectId',
    isActive: 'boolean',
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};