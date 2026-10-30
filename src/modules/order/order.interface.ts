import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';
import type { PublicUser } from '../user/user.interface';
import type { PublicPaymentMethod } from '../paymentMethod/paymentMethod.interface';

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

export interface IOrderItem {
  product: Types.ObjectId;
  size: '3ml' | '5ml' | '10ml' | '30ml';
  millilitres: number;
  unitPricePerMl: number;
  totalPrice: number;
  productSnapshot: {
    name: string;
    slug: string;
    image: IProductSnapshotImage;
  };
}

export interface IOrderCombo {
  combo: Types.ObjectId;
  name: string;
  slug: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  components: { product: Types.ObjectId; size: '3ml' | '5ml' | '10ml' | '30ml'; ml: number }[];
}

export interface IShippingAddressSnapshot {
  label?: string;
  district: string;
  area: string;
  address: string;
}

export interface IOrder {
  orderNumber: string;
  invoiceNumber?: string | null;
  customer: Types.ObjectId;
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
  inventoryReversed?: boolean;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OrderDoc = IOrder & Document & { _id: unknown };

export interface PublicOrderItem {
  product: { id: string; name: string; slug: string; image?: IProductSnapshotImage };
  size: '3ml' | '5ml' | '10ml' | '30ml';
  millilitres: number;
  unitPricePerMl: number;
  totalPrice: number;
}

export interface PublicOrderCombo {
  combo: { id: string; name: string; slug: string };
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  components: { product: string; size: '3ml' | '5ml' | '10ml' | '30ml'; ml: number }[];
}

export interface PublicOrder {
  id: string;
  orderNumber: string;
  invoiceNumber?: string | null;
  customer: PublicUser | string; // populated on detail/list, bare id on others
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
