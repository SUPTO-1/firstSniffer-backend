import mongoose, { Schema, type Model } from 'mongoose';
import type { OrderPaymentDoc } from './orderPayment.interface';

// The schema generic must match the one passed to `mongoose.model()` below
// (both `OrderPaymentDoc`) — mixing `IOrderPayment` and `OrderPaymentDoc`
// produced incompatible mongoose types.
const OrderPaymentSchema = new Schema<OrderPaymentDoc>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 1 },
    note: { type: String, default: '', trim: true, maxlength: 500 },
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

OrderPaymentSchema.index({ orderId: 1, createdAt: -1 });

export const OrderPayment: Model<OrderPaymentDoc> =
  (mongoose.models.OrderPayment as Model<OrderPaymentDoc>) ||
  mongoose.model<OrderPaymentDoc>('OrderPayment', OrderPaymentSchema);
