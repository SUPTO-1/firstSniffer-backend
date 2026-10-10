import mongoose, { Schema, type Model } from 'mongoose';
import type { IReview, ReviewDoc } from './review.interface';

const ReviewSchema = new Schema<ReviewDoc>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    comment: { type: String, required: true, trim: true, maxlength: 4000 },
    images: {
      type: [
        {
          url: { type: String, default: '' },
          fileId: { type: String, default: '' },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

/* One review per (product, customer) — keeps the moderation flow sane. */
ReviewSchema.index({ product: 1, customer: 1 }, { unique: true });

export const Review: Model<ReviewDoc> =
  (mongoose.models.Review as Model<ReviewDoc>) ||
  mongoose.model<ReviewDoc>('Review', ReviewSchema);