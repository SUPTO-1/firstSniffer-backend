import type { Document } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export type PaymentMethodType =
  | 'bkash'
  | 'nagad'
  | 'rocket'
  | 'bank'
  | 'cod';

export interface IPaymentMethod {
  name: string;
  type: PaymentMethodType;
  /** Phone/account number. Empty for `cod`. */
  accountNumber: string;
  accountName: string;
  /** Optional ImageKit QR — present for `bkash` / `nagad` / `rocket`. */
  qrImage?: { url: string; fileId: string };
  instructions: string[];
  /** Lower numbers sort first. */
  displayOrder: number;
  isActive: boolean;
  /**
   * Whether an advance payment is required for this method.
   *
   * Defaults to `false` so existing records never unexpectedly force an
   * advance.
   */
  advancePaymentRequired: boolean;
  /**
   * The advance percentage (0 < n ≤ 100). Only meaningful when
   * `advancePaymentRequired` is `true`.
   */
  advancePaymentPercent: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PaymentMethodDoc = IPaymentMethod & Document & { _id: unknown };

export interface PublicPaymentMethod {
  id: string;
  name: string;
  type: PaymentMethodType;
  accountNumber: string;
  accountName: string;
  qrImage?: { url: string; fileId: string } | null;
  instructions: string[];
  displayOrder: number;
  isActive: boolean;
  /**
   * Whether an advance payment is required for this method. Exposed
   * publicly so the storefront can render the breakdown — but the
   * backend ALWAYS recomputes the authoritative amount from the stored
   * configuration; the client value is display-only.
   */
  advancePaymentRequired: boolean;
  /** The advance percentage (0 < n ≤ 100) when required. */
  advancePaymentPercent: number;
  createdAt?: string;
  updatedAt?: string;
}

export const PAYMENT_METHOD_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name'],
  allowedFilters: {
    isActive: 'boolean',
    type: 'enum:bkash,nagad,rocket,bank,cod',
  },
  defaultSort: 'displayOrder',
  maxLimit: 100,
};
