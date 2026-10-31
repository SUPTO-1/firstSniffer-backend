import type { Request, Response } from 'express';
import { Product } from '../product/product.model';
import { InventoryBatch } from '../inventory/inventoryBatch.model';
import { InventoryLog } from '../inventoryLog/inventoryLog.model';
import { Order } from '../order/order.model';
import { User } from '../user/user.model';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { computeStockStatus } from '../inventory/inventoryBatch.service';
import type { PublicOrder } from '../order/order.interface';

export interface DashboardStats {
  products: {
    total: number;
    active: number;
  };
  inventory: {
    /** Products whose sellable stock has fallen to/below the low-stock threshold. */
    lowStockProducts: number;
    /** Products with no sellable stock left. */
    outOfStockProducts: number;
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
  /** Product-level low-stock widgets (one row per product, not per batch). */
  lowStock: Array<{
    product: { id: string; name: string; slug: string; image?: { url: string; fileId: string } };
    remainingMl: number;
    totalMl: number;
    sellableMl: number;
    status: 'in_stock' | 'low_stock' | 'out_of_stock';
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
    topSellingAgg,
  ] = await Promise.all([
    Product.countDocuments({}).exec(),
    Product.countDocuments({ deletedAt: null, isActive: true }).exec(),
    InventoryBatch.find({})
      .select('product totalMl remainingMl purchaseCost')
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

  /* ----- Product-level inventory rollup -----
   *
   * Stock is a PRODUCT-level pool: a product has many purchase batches
   * and every selling size draws from the same millilitres. So the
   * low/out-of-stock counters and the widget are computed per PRODUCT,
   * not per batch. The batch rows are only used to aggregate totals and
   * to value the stock on hand. */
  const batchRows = inventoryRaw as Array<{
    product?: unknown;
    totalMl?: number;
    remainingMl?: number;
    purchaseCost?: number;
  }>;

  interface ProductRollup {
    totalMl: number;
    remainingMl: number;
    purchaseCost: number;
  }
  const rollup = new Map<string, ProductRollup>();
  for (const row of batchRows) {
    const id = String(row.product ?? '');
    if (!id) continue;
    const current = rollup.get(id) ?? { totalMl: 0, remainingMl: 0, purchaseCost: 0 };
    current.totalMl += Number(row.totalMl ?? 0);
    current.remainingMl += Number(row.remainingMl ?? 0);
    current.purchaseCost += Number(row.purchaseCost ?? 0);
    rollup.set(id, current);
  }

  // Product settings that drive the safety buffer + low-stock threshold.
  const productSettings = await Product.find({ _id: { $in: [...rollup.keys()] } })
    .select('name slug images safetyBufferMl lowStockThresholdMl')
    .lean()
    .exec();
  const settingsById = new Map(
    productSettings.map((p) => [
      String(p._id),
      p as unknown as {
        _id: unknown;
        name?: string;
        slug?: string;
        images?: Array<{ url: string; fileId: string }>;
        safetyBufferMl?: number;
        lowStockThresholdMl?: number;
      },
    ])
  );

  let lowStockProducts = 0;
  let outOfStockProducts = 0;
  let inventoryValueBdt = 0;
  const lowStockList: DashboardStats['lowStock'] = [];

  for (const [productId, agg] of rollup.entries()) {
    inventoryValueBdt += agg.purchaseCost;
    const product = settingsById.get(productId);
    const safetyBufferMl = Math.max(0, Number(product?.safetyBufferMl ?? 0));
    const lowStockThresholdMl = Math.max(
      0,
      Number(product?.lowStockThresholdMl ?? 30)
    );
    const sellableMl = Math.max(0, agg.remainingMl - safetyBufferMl);
    const status = computeStockStatus(sellableMl, lowStockThresholdMl);
    if (status === 'low_stock') lowStockProducts++;
    if (status === 'out_of_stock') outOfStockProducts++;

    if (status !== 'in_stock') {
      lowStockList.push({
        product: product
          ? {
              id: String(product._id ?? ''),
              name: String(product.name ?? ''),
              slug: String(product.slug ?? ''),
              image: product.images?.[0],
            }
          : { id: productId, name: '', slug: '' },
        remainingMl: agg.remainingMl,
        totalMl: agg.totalMl,
        sellableMl,
        status,
      });
    }
  }

  /* ----- Map recent orders into the public shape ----- */
  const { toPublicOrder } = await import('../order/order.service');
  const recentOrders: PublicOrder[] = await Promise.all(
    (recentOrdersRaw as unknown as Array<{ _id: unknown }>).map((r) =>
      toPublicOrder(r as unknown as Parameters<typeof toPublicOrder>[0])
    )
  );

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
      lowStockProducts,
      outOfStockProducts,
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