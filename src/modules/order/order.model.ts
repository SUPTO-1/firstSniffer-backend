import mongoose, { Schema, type Model } from 'mongoose';
import {
  generateInvoiceNumber,
  generateOrderNumber,
} from '../_shared/orderNumber';
import type {
  IOrder,
  IOrderItem,
  IOrderCombo,
  IGuestInfo,
  IPaymentDetails,
  IPaymentSnapshot,
  IShippingAddressSnapshot,
  OrderDoc,
} from './order.interface';

const OrderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    size: {
      type: String,
      required: true,
      enum: ['3ml', '5ml', '10ml', '15ml', '30ml'],
    },
    /** How many bottles of this size the customer bought. */
    quantity: { type: Number, required: true, min: 1 },
    /** TOTAL millilitres dispensed on this line = sizeInMl(size) × quantity. */
    millilitres: { type: Number, required: true, min: 1 },
    /**
     * Price of ONE bottle (per decant unit).
     *
     * Renamed from `unitPricePerMl` — the old name was a lie: the stored
     * value is the per-BOTTLE price, not a per-millilitre rate.
     */
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    productSnapshot: {
      name: { type: String, required: true, trim: true },
      slug: { type: String, required: true, trim: true },
      image: {
        url: { type: String, default: '' },
        fileId: { type: String, default: '' },
      },
    },
    /**
     * Which batches this line drew stock from, and how much from each.
     *
     * Persisted so a cancellation can restore the EXACT batches that were
     * debited. Without it, a multi-batch order would be reversed into an
     * arbitrary batch of the same product.
     */
    stockAllocations: [
      {
        batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch', required: true },
        millilitres: { type: Number, required: true, min: 1 },
        _id: false,
      },
    ],
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
          enum: ['3ml', '5ml', '10ml', '15ml', '30ml'],
        },
        ml: { type: Number, required: true, min: 1 },
        /** Which batches this component drew stock from. */
        stockAllocations: [
          {
            batch: {
              type: Schema.Types.ObjectId,
              ref: 'InventoryBatch',
              required: true,
            },
            millilitres: { type: Number, required: true, min: 1 },
            _id: false,
          },
        ],
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

/**
 * Immutable snapshot of the details a GUEST entered at checkout.
 *
 * This is deliberately a snapshot rather than a live read of the guest
 * `User` row: the order must record exactly what the shopper typed, even
 * if the guest user record is later edited, merged, or deactivated by an
 * admin. It follows the same precedent as `productSnapshot` and
 * `shippingAddress` — both freeze order-time state.
 *
 * `phone` is REQUIRED — it is the only guaranteed way to reach a guest
 * for delivery, and it is the key used to find (not automatically merge)
 * their guest user record later.
 */
const GuestInfoSchema = new Schema<IGuestInfo>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: null },
    label: { type: String, trim: true, default: 'Home' },
    district: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
  },
  { _id: false }
);

/**
 * Payment evidence captured at checkout — the mobile the money was sent
 * FROM and the TrxID.
 *
 * Modelled as a real subdocument (not an inline object literal) so the
 * field stays genuinely ABSENT when the customer supplied nothing. An
 * inline literal gets auto-materialised by Mongoose into an empty `{}`,
 * which would make "no transaction details" indistinguishable from
 * "transaction details with blank fields" downstream.
 */
const PaymentDetailsSchema = new Schema<IPaymentDetails>(
  {
    senderMobile: { type: String, trim: true, maxlength: 20 },
    transactionId: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false }
);

/**
 * Immutable snapshot of the payment configuration at order-creation time.
 *
 * Frozen at creation so that a later edit to the admin's PaymentMethod
 * config can never rewrite the terms of an existing order.
 */
const PaymentSnapshotSchema = new Schema<IPaymentSnapshot>(
  {
    methodName: { type: String, default: '', trim: true },
    methodType: { type: String, default: '', trim: true },
    advanceRequired: { type: Boolean, default: false },
    advancePercent: { type: Number, default: 0, min: 0, max: 100 },
    advanceAmount: { type: Number, default: 0, min: 0 },
    remainingOnDelivery: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    accountNumber: { type: String, default: '', trim: true },
    accountName: { type: String, default: '', trim: true },
    instructions: { type: [String], default: [] },
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

    /**
     * The customer account this order belongs to.
     *
     * OPTIONAL: a guest order still gets a real `User` row (with
     * `isGuest: true` and no password) so guests are searchable in the
     * Admin Customers module — but the field is optional so an order can
     * be recorded even if that guest user row is later removed.
     *
     * For guest orders the authoritative copy of the buyer's details is
     * `guestInfo` (an immutable snapshot), NOT this reference.
     */
    customer: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    /**
     * Immutable snapshot of the guest buyer's details — present on guest
     * orders, absent on registered-customer and manual orders.
     */
    guestInfo: { type: GuestInfoSchema, default: undefined },

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

    /**
     * Payment evidence supplied by the customer at checkout — the mobile
     * the money was sent FROM and the TrxID.
     *
     * The storefront has always collected these two fields, but they were
     * never sent to the backend, so the admin had to ask every customer
     * for them again over the phone. Storing them makes manual payment
     * verification possible from the order detail alone.
     */
    paymentDetails: { type: PaymentDetailsSchema, default: undefined },

    /**
     * Frozen copy of the payment configuration used at checkout.
     *
     * Authoritative for the confirmation email, the admin order detail
     * dialog, and payment verification — so a later change to the
     * PaymentMethod config never rewrites an existing order's terms.
     */
    paymentSnapshot: { type: PaymentSnapshotSchema, default: undefined },

    /**
     * When the confirmation email was sent.
     *
     * Claimed atomically (`findOneAndUpdate` on `confirmationEmailSentAt:
     * null`) BEFORE the send, so a concurrent or repeated trigger cannot
     * deliver the email twice.
     */
    confirmationEmailSentAt: { type: Date, default: null },

    /** Set true the first time inventory is reversed for this order. */
    inventoryReversed: { type: Boolean, default: false },

    /**
     * Client-supplied idempotency key (the `Idempotency-Key` header).
     *
     * A retried create-order request carries the same key and returns the
     * ORIGINAL order instead of creating a second one and deducting stock
     * twice. Mobile clients retry on flaky networks, so this is the most
     * likely double-deduction path in production.
     *
     * NOTE: deliberately NO `default: null`. A MongoDB `sparse` index only
     * skips documents where the field is ABSENT — it does not skip documents
     * where the field is explicitly `null`. Defaulting to `null` would store
     * `null` on every order and the unique index would then reject the
     * second order ever created (E11000 duplicate key on
     * `idempotencyKey: null`). Leaving the field undefined when no key is
     * supplied is what makes the sparse index behave as intended.
     */
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 120,
      index: { unique: true, sparse: true },
    },

    /**
     * Who created the order — an admin for manual orders, the customer for
     * online orders.
     *
     * OPTIONAL: a guest order has no authenticated actor, so this stays
     * absent. It is deliberately NEVER populated with an admin id to paper
     * over that — a guest order must not look like an admin created it.
     */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },

    /**
     * High-entropy public token for guest order tracking.
     *
     * The human-readable `orderNumber` (FS-2026-000001) is SEQUENTIAL and
     * therefore guessable — using it as the capability for the public
     * order-lookup endpoint would let anyone enumerate every order in the
     * shop. This token is 32 hex chars from `crypto.randomBytes(16)` and
     * is the only value that may be used for anonymous order lookup.
     *
     * Sparse: only guest orders need one, so registered orders (which are
     * fetched through the authenticated `/users/me/orders` route) leave it
     * absent.
     */
    publicToken: {
      type: String,
      trim: true,
      lowercase: true,
      index: { unique: true, sparse: true },
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
