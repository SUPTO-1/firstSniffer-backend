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

    /**
     * Whether customers must pay part of the order up front.
     *
     * Configured per payment method so bKash can demand a 30% advance
     * while Nagad (or Cash on Delivery) asks for nothing.
     *
     * BACKWARD COMPATIBLE: defaults to `false`, so every EXISTING
     * PaymentMethod record keeps forcing no advance. A record created
     * before this field existed is read by MongoDB as missing, and
     * Mongoose applies the default on read/hydration.
     */
    advancePaymentRequired: { type: Boolean, default: false },

    /**
     * The percentage of the order total that must be paid up front.
     *
     * Only meaningful when `advancePaymentRequired` is `true`. The
     * authoritative amount is computed and FROZEN onto each order at
     * creation time (see `Order.paymentSnapshot`), so later edits to this
     * field never change a historical order.
     */
    advancePaymentPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
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

export const PaymentMethod: Model<PaymentMethodDoc> =
  (mongoose.models.PaymentMethod as Model<PaymentMethodDoc>) ||
  mongoose.model<PaymentMethodDoc>('PaymentMethod', PaymentMethodSchema);
