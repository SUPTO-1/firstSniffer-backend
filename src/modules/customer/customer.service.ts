import type { FilterQuery, Types } from 'mongoose';
import { User } from '../user/user.model';
import { Order } from '../order/order.model';
import { ApiError } from '../../utils/ApiError';
import {
  buildMongooseQuery,
  executePagedQuery,
  type PagedResult,
} from '../../utils/queryBuilder';
import type {
  CustomerListItem,
  CustomerDetail,
  ICustomer,
} from './customer.interface';
import { CUSTOMER_QUERY_CONFIG } from './customer.interface';
import { pickWritable } from '../_shared/pickWritable';
import { BD_MOBILE_REGEX } from '../user/user.constants';
import type { IAddress } from '../user/user.interface';

const WRITABLE_CUSTOMER_KEYS = ['name', 'phone', 'email'] as const;

/* ------------------------------------------------------------------
 *  Metrics aggregation — per-customer order totals.
 *  Done in a single aggregation so a list of 50 customers costs 1
 *  query, not 50. Uses paymentStatus:'paid' to count only completed
 *  revenue.
 * ------------------------------------------------------------------ */
interface MetricsAggRow {
  _id: unknown;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: Date | null;
}

async function aggregateMetrics(customerIds: string[]): Promise<Map<string, MetricsAggRow>> {
  if (customerIds.length === 0) return new Map();
  const objectIds = customerIds.map((id) => id as unknown as Types.ObjectId);
  const rows = await Order.aggregate<MetricsAggRow>([
    {
      $match: {
        customer: { $in: objectIds },
        paymentStatus: 'paid',
      },
    },
    {
      $group: {
        _id: '$customer',
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: '$total' },
        lastOrderAt: { $max: '$createdAt' },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

/* ------------------------------------------------------------------ */

function toListItem(
  doc: Record<string, unknown>,
  metrics: MetricsAggRow | undefined
): CustomerListItem {
  return {
    id: String(doc._id),
    name: (doc.name as string) ?? '',
    phone: (doc.phone as string | null) ?? null,
    email: (doc.email as string | null) ?? null,
    isActive: doc.isActive !== false,
    totalOrders: metrics?.totalOrders ?? 0,
    totalSpent: metrics?.totalSpent ?? 0,
    lastOrderAt: metrics?.lastOrderAt?.toISOString?.() ?? null,
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? '',
  };
}

function toDetail(doc: Record<string, unknown>): CustomerDetail {
  const addresses = ((doc.addresses as IAddress[]) ?? []).map((a) => ({
    id: a._id ? String(a._id) : '',
    label: a.label ?? 'Home',
    district: a.district,
    area: a.area,
    address: a.address,
    isDefault: !!a.isDefault,
  }));
  return {
    id: String(doc._id),
    name: (doc.name as string) ?? '',
    phone: (doc.phone as string | null) ?? null,
    email: (doc.email as string | null) ?? null,
    isActive: doc.isActive !== false,
    addresses,
    totalOrders: 0,
    totalSpent: 0,
    lastOrderAt: null,
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? '',
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? '',
  };
}

export async function listCustomers(
  queryStr: Record<string, unknown>
): Promise<PagedResult<CustomerListItem>> {
  // Run the Query Builder against the underlying User collection, then
  // narrow to role:'customer' and aggregate metrics. We do this in two
  // steps because the Query Builder filters on a single collection.
  const built = buildMongooseQuery<ICustomer>(
    queryStr,
    CUSTOMER_QUERY_CONFIG
  );
  const filter: FilterQuery<ICustomer> = {
    ...built.filter,
    role: 'customer',
  };

  const [rows, total] = await Promise.all([
    User.find(filter)
      .sort(built.sort)
      .skip(built.skip)
      .limit(built.limit)
      .select('name phone email isActive createdAt')
      .lean()
      .exec(),
    User.countDocuments(filter).exec(),
  ]);

  const ids = rows.map((r) => String(r._id));
  const metrics = await aggregateMetrics(ids);

  return {
    results: rows.map((r) =>
      toListItem(r as unknown as Record<string, unknown>, metrics.get(String(r._id)))
    ),
    page: built.page,
    limit: built.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / built.limit),
  };
}

export async function getCustomerById(id: string): Promise<CustomerDetail> {
  const doc = await User.findOne({ _id: id, role: 'customer' }).lean().exec();
  if (!doc) throw ApiError.notFound('Customer not found');
  const detail = toDetail(doc as unknown as Record<string, unknown>);
  const metrics = await aggregateMetrics([id]);
  const m = metrics.get(id);
  if (m) {
    detail.totalOrders = m.totalOrders;
    detail.totalSpent = m.totalSpent;
    detail.lastOrderAt = m.lastOrderAt?.toISOString?.() ?? null;
  }
  return detail;
}

export async function createCustomer(input: {
  name: string;
  phone: string;
  email?: string;
  address?: IAddress;
}): Promise<CustomerDetail> {
  if (!BD_MOBILE_REGEX.test(input.phone)) {
    throw ApiError.badRequest('Invalid Bangladeshi mobile number');
  }
  try {
    const addresses = input.address ? [{ ...input.address, isDefault: true }] : [];
    const created = await User.create({
      name: input.name,
      phone: input.phone,
      email: input.email?.toLowerCase() ?? null,
      role: 'customer',
      addresses,
    });
    return getCustomerById(String(created._id));
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 11000
    ) {
      throw ApiError.badRequest('Email already in use');
    }
    throw err;
  }
}

export async function updateCustomer(
  id: string,
  input: Record<string, unknown>
): Promise<CustomerDetail> {
  const set = pickWritable(input, WRITABLE_CUSTOMER_KEYS);
  const doc = await User.findOneAndUpdate(
    { _id: id, role: 'customer' },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Customer not found');
  return getCustomerById(id);
}

export async function toggleCustomerActive(
  id: string,
  isActive: boolean
): Promise<CustomerDetail> {
  const doc = await User.findOneAndUpdate(
    { _id: id, role: 'customer' },
    { $set: { isActive } },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Customer not found');
  return getCustomerById(id);
}

export async function addCustomerAddress(
  id: string,
  input: IAddress
): Promise<CustomerDetail> {
  const user = await User.findOne({ _id: id, role: 'customer' });
  if (!user) throw ApiError.notFound('Customer not found');

  // If the new address is default, unset others first.
  if (input.isDefault) {
    user.addresses.forEach((a) => {
      a.isDefault = false;
    });
  }
  // If user has no addresses yet, force default.
  const isDefault = input.isDefault ?? user.addresses.length === 0;
  user.addresses.push({ ...input, isDefault });
  await user.save();
  return getCustomerById(id);
}

export async function removeCustomerAddress(
  id: string,
  addressId: string
): Promise<CustomerDetail> {
  const user = await User.findOne({ _id: id, role: 'customer' });
  if (!user) throw ApiError.notFound('Customer not found');

  const before = user.addresses.length;
  user.addresses = user.addresses.filter(
    (a) => String(a._id) !== addressId
  ) as typeof user.addresses;
  if (user.addresses.length === before) {
    throw ApiError.notFound('Address not found');
  }
  // If the removed address was default and other addresses remain, promote the first.
  if (!user.addresses.some((a) => a.isDefault) && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }
  await user.save();
  return getCustomerById(id);
}
