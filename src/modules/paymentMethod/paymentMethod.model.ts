import mongoose, { Schema, type Model } from 'mongoose';
import type { IPaymentMethod, PaymentMethodDoc } from './paymentMethod.interface';

const PaymentMethodSchema = new Schema<PaymentMethodDoc>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name is too long'],
    },
    type: {
      type: String,
      required: true,
      enum: ['bkash', 'nagad', 'rocket', 'bank', 'cod'],
      index: true,
    },
    accountNumber: { type: String, default: '', trim: true, maxlength: 80 },
    accountName: { type: String, default: '', trim: true, maxlength: 80 },
    qrImage: {
      url: { type: String, default: '' },
      fileId: { type: String, default: '' },
    },
    instructions: { type: [String], default: [] },
    displayOrder: { type: Number, default: 0, min: 0, index: true },
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

export const PaymentMethod: Model<PaymentMethodDoc> =
  (mongoose.models.PaymentMethod as Model<PaymentMethodDoc>) ||
  mongoose.model<PaymentMethodDoc>('PaymentMethod', PaymentMethodSchema);
