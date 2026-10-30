import type { Document, Types } from 'mongoose';

export interface IOrderReview {
  orderId: Types.ObjectId;
  image?: { url: string; fileId: string };
  comment?: string;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

// Matches the `I<Model> & Document & { _id: unknown }` convention used by every
// other model in the codebase. Using `HydratedDocument<I…>` here diverged from
// mongoose's expected shape and broke the `mongoose.models.X` cast below.
export type OrderReviewDoc = IOrderReview & Document & { _id: unknown };

export interface PublicOrderReview {
  id: string;
  orderId: string;
  image?: { url: string; fileId: string };
  comment?: string;
  createdBy: { id: string; name: string };
  createdAt?: string;
  updatedAt?: string;
}
