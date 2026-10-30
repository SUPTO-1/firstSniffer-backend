import mongoose, { Schema, type Model } from 'mongoose';
import {
  generateInvoiceNumber,
  generateOrderNumber,
} from '../_shared/orderNumber';
import type {
  IOrder,
  IOrderItem,
  IOrderCombo,
  IShippingAddressSnapshot,
  OrderDoc,
} from './order.interface';

const OrderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    size: {
      type: String,
      required: true,
      enum: ['3ml', '5ml', '10ml', '30ml'],
    },
    millilitres: { type: Number, required: true, min: 1 },
    unitPricePerMl: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    productSnapshot: {
      name: { type: String, required: true, trim: true },
      slug: { type: String, required: true, trim: true },
      image: {
        url: { type: String, default: '' },
        fileId: { type: String, default: '' },
      },
    },
  },
  { _id: false }
);

const OrderComboSchema = new Schema<IOrderCombo>(
  {
    combo: { type: Schema.Types.ObjectId, ref: 'Combo', required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    components: [
      {
        product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        size: {
          type: String,
          required: true,
          enum: ['3ml', '5ml', '10ml', '30ml'],
        },
        ml: { type: Number, required: true, min: 1 },
        _id: false,
      },
    ],
  },
  { _id: false }
);

const ShippingAddressSchema = new Schema<IShippingAddressSnapshot>(
  {
    label: { type: String, trim: true, default: 'Home' },
    district: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const OrderSchema = new Schema<OrderDoc>(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    invoiceNumber: { type: String, default: null, trim: true },

    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    orderSource: {
      type: String,
      enum: ['online', 'manual'],
      required: true,
      index: true,
    },

    items: { type: [OrderItemSchema], default: [] },
    combos: { type: [OrderComboSchema], default: [] },

    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    couponCode: { type: String, default: null, trim: true, uppercase: true },
    couponRef: { type: Schema.Types.ObjectId, ref: 'Coupon', default: null },

    shippingCharge: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    /** Running sum of all `OrderPayment` records. Updated by the
     *  record-payment endpoint and by the manual flip to `'paid'`. */
    paidAmount: { type: Number, required: true, min: 0, default: 0 },

    paymentMethod: {
      type: Schema.Types.ObjectId,
      ref: 'PaymentMethod',
      default: null,
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'pending_verification', 'paid', 'refunded', 'failed'],
      default: 'unpaid',
      index: true,
    },
    orderStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'pending',
      index: true,
    },

    shippingAddress: { type: ShippingAddressSchema, required: true },
    notes: { type: String, default: '', trim: true, maxlength: 1000 },

    /** Set true the first time inventory is reversed for this order. */
    inventoryReversed: { type: Boolean, default: false },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
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

OrderSchema.index({ customer: 1, createdAt: -1 });

/**
 * Auto-mint an order number AND invoice number before validation when
 * the caller hasn't supplied them. Both counters are year-stamped and
 * atomic — see `_shared/orderNumber.ts`.
 */
OrderSchema.pre('validate', async function () {
  if (!this.orderNumber) {
    this.orderNumber = await generateOrderNumber();
  }
  if (!this.invoiceNumber) {
    this.invoiceNumber = await generateInvoiceNumber();
  }
});

export const Order: Model<OrderDoc> =
  (mongoose.models.Order as Model<OrderDoc>) ||
  mongoose.model<OrderDoc>('Order', OrderSchema);
