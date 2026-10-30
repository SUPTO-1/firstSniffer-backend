import type { Document, Types } from 'mongoose';

export interface IOrderPayment {
  orderId: Types.ObjectId;
  amount: number;
  note?: string;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

// Matches the `I<Model> & Document & { _id: unknown }` convention used by every
// other model in the codebase. Using `HydratedDocument<I…>` here diverged from
// mongoose's expected shape and broke the `mongoose.models.X` cast below.
export type OrderPaymentDoc = IOrderPayment & Document & { _id: unknown };

export interface PublicOrderPayment {
  id: string;
  orderId: string;
  amount: number;
  note?: string;
  createdBy: { id: string; name: string };
  createdAt?: string;
  updatedAt?: string;
}
