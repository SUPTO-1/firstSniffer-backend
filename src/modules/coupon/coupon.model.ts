import mongoose, { Schema, type Model } from 'mongoose';
import type { ICoupon, CouponDoc } from './coupon.interface';

const CouponSchema = new Schema<CouponDoc>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['fixed', 'percentage'],
      required: true,
    },
    value: { type: Number, required: true, min: 0 },
    minPurchase: { type: Number, default: 0, min: 0 },
    maxDiscount: { type: Number, default: null, min: 0 },
    expiresAt: { type: Date, default: null },
    usageLimit: { type: Number, required: true, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
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

export const Coupon: Model<CouponDoc> =
  (mongoose.models.Coupon as Model<CouponDoc>) ||
  mongoose.model<CouponDoc>('Coupon', CouponSchema);