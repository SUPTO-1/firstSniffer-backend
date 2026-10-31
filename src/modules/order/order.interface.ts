import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';
import type { PublicUser } from '../user/user.interface';
import type { PublicPaymentMethod } from '../paymentMethod/paymentMethod.interface';
import type { ProductSize } from '../_shared/validation';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type PaymentStatus =
  | 'unpaid'
  | 'pending_verification'
  | 'paid'
  | 'refunded'
  | 'failed';

export type OrderSource = 'online' | 'manual';

export interface IProductSnapshotImage {
  url: string;
  fileId: string;
}

/** Which batch a stock movement belongs to, and how much it moved. */
export interface IStockAllocation {
  batch: Types.ObjectId;
  millilitres: number;
}

export interface IOrderItem {
  product: Types.ObjectId;
  size: ProductSize;
  /** How many bottles of this size were bought. */
  quantity: number;
  /** TOTAL ml dispensed = sizeInMl(size) × quantity. */
  millilitres: number;
  /** Price of ONE bottle (per decant unit), not a per-ml rate. */
  unitPrice: number;
  totalPrice: number;
  productSnapshot: {
    name: string;
    slug: string;
    image: IProductSnapshotImage;
  };
  /** Which batches this line drew stock from — enables exact restoration. */
  stockAllocations: IStockAllocation[];
}

export interface IOrderCombo {
  combo: Types.ObjectId;
  name: string;
  slug: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  components: {
    product: Types.ObjectId;
    size: ProductSize;
    ml: number;
    stockAllocations: IStockAllocation[];
  }[];
}

export interface IShippingAddressSnapshot {
  label?: string;
  district: string;
  area: string;
  address: string;
}

/**
 * Immutable snapshot of a guest buyer's checkout details.
 *
 * Stored ON the order so the record of what the shopper typed survives
 * any later edit, merge, or deactivation of the guest `User` row.
 */
export interface IGuestInfo {
  name: string;
  /** Required — the only guaranteed way to reach a guest for delivery. */
  phone: string;
  email?: string | null;
  label?: string;
  district: string;
  area: string;
  address: string;
}

/**
 * Payment evidence captured at checkout — the mobile the money was sent
 * FROM and the TrxID.
 *
 * The storefront has always collected these two fields, but they were
 * never sent to the backend, so the admin had to ask every customer for
 * them again over the phone. Storing them makes manual payment
 * verification possible from the order detail alone.
 */
export interface IPaymentDetails {
  senderMobile?: string;
  transactionId?: string;
}

/**
 * Immutable snapshot of the payment configuration at order-creation time.
 *
 * WHY A SNAPSHOT: the advance percentage is admin-configurable per
 * payment method. If an order read the LIVE `PaymentMethod` record at
 * every point in its life, editing that config would silently rewrite
 * the terms of every historical order — changing how much a customer
 * owes, changing what the confirmation email said, and changing what
 * the admin's verification screen compares against.
 *
 * Everything downstream reads THIS snapshot, never the live config:
 * - the confirmation email,
 * - the admin order detail dialog,
 * - the payment-verification comparison.
 */
export interface IPaymentSnapshot {
  /** The method's display name at order time. */
  methodName: string;
  /** The method's type (`bkash`, `nagad`, `cod`, …) at order time. */
  methodType: string;
  /** Whether an advance was required at order time. */
  advanceRequired: boolean;
  /** The advance percentage at order time (0 when not required). */
  advancePercent: number;
  /**
   * The authoritative advance amount in BDT, computed by the backend at
   * creation time. This is the number the customer must pay up front.
   */
  advanceAmount: number;
  /** What is still payable on delivery. */
  remainingOnDelivery: number;
  /** The order's final payable total at order time. */
  totalAmount: number;
  /** The account number the customer was told to pay to. */
  accountNumber?: string;
  /** The account name the customer was told to pay to. */
  accountName?: string;
  /** The admin-authored instructions shown to the customer. */
  instructions?: string[];
}

export interface IOrder {
  orderNumber: string;
  invoiceNumber?: string | null;
  /**
   * The customer account this order belongs to. Present for registered
   * customers AND guests (guests get a real `User` row with
   * `isGuest: true`), but optional so an order survives the removal of
   * that row.
   */
  customer?: Types.ObjectId | null;
  /**
   * Immutable snapshot of a guest buyer's details. Present on guest
   * orders only; `null`/absent for registered and manual orders.
   */
  guestInfo?: IGuestInfo | null;
  orderSource: OrderSource;
  items: IOrderItem[];
  combos: IOrderCombo[];
  subtotal: number;
  discount: number;
  couponCode?: string | null;
  couponRef?: Types.ObjectId | null;
  shippingCharge: number;
  total: number;
  paidAmount: number;
  paymentMethod?: Types.ObjectId | null;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  shippingAddress: IShippingAddressSnapshot;
  notes?: string;
  /**
   * Payment evidence supplied at checkout — sender mobile + TrxID. Lets
   * the admin verify a mobile-money payment from the order detail alone.
   */
  paymentDetails?: IPaymentDetails;
  /**
   * Frozen copy of the payment configuration used when the order was
   * placed. Authoritative for every later read of this order's payment
   * terms.
   */
  paymentSnapshot?: IPaymentSnapshot;
  /**
   * When the order confirmation email was sent.
   *
   * Claimed ATOMICALLY before the send so a duplicate trigger (a retried
   * request, a concurrent admin action) can never produce a second
   * email.
   */
  confirmationEmailSentAt?: Date | null;
  inventoryReversed?: boolean;
  /** Client idempotency key — unique, sparse. */
  idempotencyKey?: string | null;
  /**
   * High-entropy public token for anonymous order lookup. Present on
   * guest orders; the human-readable `orderNumber` is NOT suitable
   * because it is sequential and guessable.
   */
  publicToken?: string | null;
  /**
   * The authenticated actor that created the order (admin for manual
   * orders, customer for online orders). Absent for guest orders — never
   * filled with an admin id to paper over the absence.
   */
  createdBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OrderDoc = IOrder & Document & { _id: unknown };

export interface PublicOrderItem {
  product: { id: string; name: string; slug: string; image?: IProductSnapshotImage };
  size: ProductSize;
  /** How many bottles of this size were bought. */
  quantity: number;
  /** TOTAL ml dispensed on this line. */
  millilitres: number;
  /** Price of ONE bottle (per decant unit). */
  unitPrice: number;
  totalPrice: number;
  /** Which batches this line drew stock from. */
  stockAllocations: { batch: string; millilitres: number }[];
}

export interface PublicOrderCombo {
  combo: { id: string; name: string; slug: string };
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  components: {
    product: string;
    size: ProductSize;
    ml: number;
    /** Which batches this component drew stock from. */
    stockAllocations?: { batch: string; millilitres: number }[];
  }[];
}

export interface PublicOrder {
  id: string;
  orderNumber: string;
  invoiceNumber?: string | null;
  customer: PublicUser | string; // populated on detail/list, bare id on others
  /**
   * Immutable snapshot of a guest buyer's details. Present on guest
   * orders only — the storefront receipt and the admin order detail
   * dialog read this when `customer` is not a populated account.
   */
  guestInfo?: IGuestInfo | null;
  /** True when this order was placed without an account. */
  isGuestOrder?: boolean;
  /**
   * The secure tracking token. Returned to the buyer (and to admins) so
   * the order can be looked up anonymously. It is the capability that
   * protects the order from enumeration — the sequential `orderNumber`
   * is not.
   */
  publicToken?: string | null;
  orderSource: OrderSource;
  items: PublicOrderItem[];
  combos: PublicOrderCombo[];
  subtotal: number;
  discount: number;
  couponCode?: string | null;
  shippingCharge: number;
  total: number;
  paymentMethod?: PublicPaymentMethod | null;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  shippingAddress: IShippingAddressSnapshot;
  notes?: string;
  /**
   * Payment evidence supplied at checkout — sender mobile + TrxID.
   * Surfaced in the admin order detail dialog for payment verification.
   */
  paymentDetails?: IPaymentDetails | null;
  /**
   * Frozen payment configuration for this order. Read by the admin
   * order detail dialog and the storefront receipt so both show the
   * terms the customer actually agreed to.
   */
  paymentSnapshot?: IPaymentSnapshot | null;
  inventoryReversed?: boolean;
  paidAmount: number;
  createdBy: { id: string; name: string };
  createdAt?: string;
  updatedAt?: string;
}

export const ORDER_QUERY_CONFIG: QueryConfig = {
  searchFields: ['orderNumber', 'invoiceNumber', 'notes'],
  allowedFilters: {
    orderSource: 'enum:online,manual',
    paymentStatus: 'enum:unpaid,pending_verification,paid,refunded,failed',
    orderStatus: 'enum:pending,confirmed,processing,shipped,delivered,cancelled,returned',
    customer: 'objectId',
    createdAt: { type: 'dateRange', from: 'from', to: 'to' },
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};

/* Order-status state machine — see plan §6.1 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
