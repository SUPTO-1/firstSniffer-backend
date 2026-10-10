import type { Request, Response } from 'express';
import { Product } from '../product/product.model';
import { Inventory } from '../inventory/inventory.model';
import { InventoryLog } from '../inventoryLog/inventoryLog.model';
import { Order } from '../order/order.model';
import { User } from '../user/user.model';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { computeStatus } from '../inventory/inventory.service';
import type { PublicOrder } from '../order/order.interface';

export interface DashboardStats {
  products: {
    total: number;
    active: number;
  };
  inventory: {
    lowStockBatches: number;
    outOfStockBatches: number;
    inventoryValueBdt: number;
  };
  recentMovements: {
    last7Days: number;
  };
  orders: {
    total: number;
    todayCount: number;
    last7DaysCount: number;
    pendingCount: number;
  };
  revenue: {
    totalPaid: number;
    last30DaysPaid: number;
  };
  customers: {
    total: number;
    active: number;
    newLast30Days: number;
  };
  recentOrders: PublicOrder[];
  lowStock: Array<{
    inventoryId: string;
    product: { id: string; name: string; slug: string; image?: { url: string; fileId: string } };
    bottleSize: string;
    remainingMl: number;
    totalMl: number;
  }>;
  topSelling: Array<{
    product: { id: string; name: string; slug: string; image?: { url: string; fileId: string } };
    totalMlSold: number;
    orderCount: number;
  }>;
  /** ISO timestamp the snapshot was generated at. */
  generatedAt: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);

  const [
    totalProducts,
    activeProducts,
    inventoryRaw,
    recentMovements,
    totalOrders,
    todayCount,
    last7DaysCount,
    pendingCount,
    revenueAgg,
    revenue30Agg,
    totalCustomers,
    activeCustomers,
    newLast30Days,
    recentOrdersRaw,
    lowStockRaw,
    topSellingAgg,
  ] = await Promise.all([
    Product.countDocuments({}).exec(),
    Product.countDocuments({ deletedAt: null, isActive: true }).exec(),
    Inventory.find({})
      .select('totalMl remainingMl purchaseCost lowStockThresholdMl')
      .lean()
      .exec(),
    InventoryLog.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    }).exec(),

    Order.countDocuments({}).exec(),
    Order.countDocuments({ createdAt: { $gte: today } }).exec(),
    Order.countDocuments({ createdAt: { $gte: sevenDaysAgo } }).exec(),
    Order.countDocuments({ orderStatus: 'pending' }).exec(),

    Order.aggregate<{ _id: null; total: number }>([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Order.aggregate<{ _id: null; total: number }>([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),

    User.countDocuments({ role: 'customer' }).exec(),
    User.countDocuments({ role: 'customer', isActive: { $ne: false } }).exec(),
    User.countDocuments({
      role: 'customer',
      createdAt: { $gte: thirtyDaysAgo },
    }).exec(),

    Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('customer', 'name phone email role')
      .populate('paymentMethod')
      .lean()
      .exec(),

    Inventory.find({ remainingMl: { $gt: 0 } })
      .sort({ remainingMl: 1 })
      .limit(5)
      .populate('product', 'name slug images')
      .lean()
      .exec(),

    InventoryLog.aggregate<{
      _id: unknown;
      totalMlSold: number;
      orderCount: number;
    }>([
      {
        $match: {
          type: 'sale',
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: '$product',
          totalMlSold: { $sum: '$quantityMl' },
          orderCount: { $addToSet: '$referenceId' },
        },
      },
      {
        $project: {
          _id: 1,
          totalMlSold: 1,
          orderCount: { $size: '$orderCount' },
        },
      },
      { $sort: { totalMlSold: -1 } },
      { $limit: 5 },
    ]),
  ]);

  /* ----- Inventory rollup ----- */
  let lowStock = 0;
  let outOfStock = 0;
  let inventoryValueBdt = 0;
  for (const row of inventoryRaw as Array<{
    totalMl?: number;
    remainingMl?: number;
    purchaseCost?: number;
    lowStockThresholdMl?: number;
  }>) {
    const total = Number(row.totalMl ?? 0);
    const remaining = Number(row.remainingMl ?? 0);
    const threshold = Number(row.lowStockThresholdMl ?? 30);
    inventoryValueBdt += Number(row.purchaseCost ?? 0);
    const status = computeStatus(remaining, total, threshold);
    if (status === 'low_stock') lowStock++;
    if (status === 'out_of_stock') outOfStock++;
  }

  /* ----- Map recent orders into the public shape ----- */
  const { toPublicOrder } = await import('../order/order.service');
  const recentOrders: PublicOrder[] = await Promise.all(
    (recentOrdersRaw as unknown as Array<{ _id: unknown }>).map((r) =>
      toPublicOrder(r as unknown as Parameters<typeof toPublicOrder>[0])
    )
  );

  /* ----- Low stock widgets ----- */
  const lowStockList = (lowStockRaw as Array<{
    _id: unknown;
    product?: { _id?: unknown; name?: string; slug?: string; images?: Array<{ url: string; fileId: string }> };
    bottleSize?: string;
    remainingMl?: number;
    totalMl?: number;
  }>).map((row) => ({
    inventoryId: String(row._id),
    product: row.product
      ? {
          id: String(row.product._id ?? ''),
          name: String(row.product.name ?? ''),
          slug: String(row.product.slug ?? ''),
          image: row.product.images?.[0],
        }
      : { id: '', name: '', slug: '' },
    bottleSize: String(row.bottleSize ?? ''),
    remainingMl: Number(row.remainingMl ?? 0),
    totalMl: Number(row.totalMl ?? 0),
  }));

  /* ----- Top selling products ----- */
  const topIds = topSellingAgg.map((r) => String(r._id));
  const topProducts = topIds.length
    ? await Product.find({ _id: { $in: topIds } })
        .select('name slug images')
        .lean()
        .exec()
    : [];
  const topById = new Map(
    topProducts.map((p) => [
      String(p._id),
      p as unknown as { _id: unknown; name?: string; slug?: string; images?: Array<{ url: string; fileId: string }> },
    ])
  );
  const topSelling = topSellingAgg.map((r) => {
    const p = topById.get(String(r._id));
    return {
      product: p
        ? {
            id: String(p._id ?? ''),
            name: p.name ?? '',
            slug: p.slug ?? '',
            image: p.images?.[0],
          }
        : { id: String(r._id), name: '', slug: '' },
      totalMlSold: r.totalMlSold,
      orderCount: r.orderCount,
    };
  });

  const data: DashboardStats = {
    products: { total: totalProducts, active: activeProducts },
    inventory: {
      lowStockBatches: lowStock,
      outOfStockBatches: outOfStock,
      inventoryValueBdt,
    },
    recentMovements: { last7Days: recentMovements },
    orders: {
      total: totalOrders,
      todayCount,
      last7DaysCount,
      pendingCount,
    },
    revenue: {
      totalPaid: revenueAgg[0]?.total ?? 0,
      last30DaysPaid: revenue30Agg[0]?.total ?? 0,
    },
    customers: {
      total: totalCustomers,
      active: activeCustomers,
      newLast30Days,
    },
    recentOrders,
    lowStock: lowStockList,
    topSelling,
    generatedAt: new Date().toISOString(),
  };

  return sendResponse(res, { message: 'Stats fetched', data });
});