import mongoose, { Schema, type Model } from 'mongoose';
import type { OrderReviewDoc } from './orderReview.interface';

// The schema generic must match the one passed to `mongoose.model()` below
// (both `OrderReviewDoc`) — mixing `IOrderReview` and `OrderReviewDoc`
// produced incompatible mongoose types.
const OrderReviewSchema = new Schema<OrderReviewDoc>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    image: {
      url: { type: String, default: '' },
      fileId: { type: String, default: '' },
    },
    comment: { type: String, default: '', trim: true, maxlength: 2000 },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
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

/**
 * Safety net: zod validates this at the request boundary, but enforce
 * it again here so direct DB writes (scripts, etc.) can't bypass it.
 */
OrderReviewSchema.pre('validate', function (next) {
  const hasImage =
    !!(this.image?.url && String(this.image.url).length > 0) &&
    !!(this.image?.fileId && String(this.image.fileId).length > 0);
  const hasComment = !!(this.comment && String(this.comment).trim().length > 0);
  if (!hasImage && !hasComment) {
    return next(
      new Error('OrderReview requires at least one of image or comment')
    );
  }
  return next();
});

OrderReviewSchema.index({ orderId: 1, createdAt: -1 });

export const OrderReview: Model<OrderReviewDoc> =
  (mongoose.models.OrderReview as Model<OrderReviewDoc>) ||
  mongoose.model<OrderReviewDoc>('OrderReview', OrderReviewSchema);
