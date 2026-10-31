import { Product } from '../product/product.model';
import { ApiError } from '../../utils/ApiError';
import {
  buildMongooseQuery,
  type PagedResult,
  type QueryConfig,
} from '../../utils/queryBuilder';
import {
  computeStockStatus,
  getProductStock,
  getProductStockForProducts,
} from './inventoryBatch.service';
import type { InventoryStatus, ProductStock } from './inventoryBatch.interface';

/**
 * A product-level inventory row — what the admin inventory table shows.
 *
 * One row per product, with its stock rolled up live from that product's
 * batches. There is no summary collection: the batches ARE the source of
 * truth, and this is a computed view over them.
 */
export interface PublicProductStockRow extends Omit<ProductStock, 'productId'> {
  /** Populated product reference for the admin table. */
  product: {
    id: string;
    name: string;
    slug: string;
    image: { url: string; fileId: string } | null;
  } | null;
  /** Active + enabled selling sizes for this product. */
  enabledSizes: string[];
}

const PRODUCT_STOCK_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: {
    isActive: 'boolean',
    brand: 'objectId',
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};

/**
 * List every product with its aggregated stock.
 *
 * The status filter is applied SERVER-SIDE and BEFORE pagination. The old
 * admin screen filtered client-side over the rows on the current page only,
 * which silently hid every low-stock product that wasn't on page 1.
 *
 * Because the status is a DERIVED value (it depends on the batch
 * aggregation and the product's safety buffer), it cannot be pushed into
 * the Mongo query. We therefore compute the status for the whole filtered
 * product set, apply the status filter, and only then paginate.
 */
export async function listProductStock(
  queryStr: Record<string, unknown>
): Promise<PagedResult<PublicProductStockRow>> {
  const { filter, sort, skip, limit, page } =
    buildMongooseQuery<Record<string, unknown>>(
      queryStr,
      PRODUCT_STOCK_QUERY_CONFIG
    );

  const products = await Product.find(filter)
    .sort(sort)
    .select('name slug images brand variants isActive deletedAt')
    .lean()
    .exec();

  const productIds = products.map((p) => String((p as { _id: unknown })._id));
  const stockByProduct = await getProductStockForProducts(productIds);

  const requestedStatus = String(queryStr.status ?? '').trim();

  const rows: PublicProductStockRow[] = products.map((p) => {
    const raw = p as unknown as {
      _id: unknown;
      name?: string;
      slug?: string;
      images?: Array<{ url: string; fileId: string }>;
      variants?: Array<{ size: string; isActive?: boolean }>;
    };
    const id = String(raw._id);
    const stock = stockByProduct.get(id);
    const image = raw.images?.[0]
      ? { url: raw.images[0].url, fileId: raw.images[0].fileId }
      : null;
    return {
      product: {
        id,
        name: raw.name ?? '',
        slug: raw.slug ?? '',
        image,
      },
      productName: raw.name ?? '',
      totalMl: stock?.totalMl ?? 0,
      remainingMl: stock?.remainingMl ?? 0,
      safetyBufferMl: stock?.safetyBufferMl ?? 0,
      sellableMl: stock?.sellableMl ?? 0,
      lowStockThresholdMl: stock?.lowStockThresholdMl ?? 30,
      batchCount: stock?.batchCount ?? 0,
      status: stock?.status ?? 'out_of_stock',
      enabledSizes: (raw.variants ?? [])
        .filter((v) => v.isActive !== false)
        .map((v) => v.size),
    };
  });

  // Server-side status filter — applied to the WHOLE catalogue, BEFORE
  // pagination, so `total` and `totalPages` reflect the filtered set.
  const filtered =
    requestedStatus &&
    ['in_stock', 'low_stock', 'out_of_stock'].includes(requestedStatus)
      ? rows.filter((r) => r.status === (requestedStatus as InventoryStatus))
      : rows;

  const total = filtered.length;
  const paged = filtered.slice(skip, skip + limit);

  return {
    results: paged,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

/**
 * Read (or update) the product-level inventory settings — the safety buffer
 * and the low-stock threshold.
 *
 * These live on the Product document (D4) rather than in their own
 * collection: two scalars do not justify a collection, and keeping them next
 * to the product means one read gives the admin everything they need.
 */
export interface ProductInventorySettings {
  product: string;
  productName: string;
  safetyBufferMl: number;
  lowStockThresholdMl: number;
  /** Derived live stock for the product. */
  totalMl: number;
  remainingMl: number;
  sellableMl: number;
  batchCount: number;
  status: InventoryStatus;
}

export async function getInventorySettings(
  productId: string
): Promise<ProductInventorySettings> {
  const product = await Product.findById(productId)
    .select('name safetyBufferMl lowStockThresholdMl')
    .lean()
    .exec();
  if (!product) throw ApiError.notFound('Product not found');

  const stock = await getProductStock(productId);
  return {
    product: productId,
    productName: stock.productName,
    safetyBufferMl: stock.safetyBufferMl,
    lowStockThresholdMl: stock.lowStockThresholdMl,
    totalMl: stock.totalMl,
    remainingMl: stock.remainingMl,
    sellableMl: stock.sellableMl,
    batchCount: stock.batchCount,
    status: stock.status,
  };
}

export async function updateInventorySettings(
  productId: string,
  input: { safetyBufferMl?: number; lowStockThresholdMl?: number }
): Promise<ProductInventorySettings> {
  const set: Record<string, number> = {};
  if (input.safetyBufferMl !== undefined) {
    const v = Math.max(0, Math.round(Number(input.safetyBufferMl) || 0));
    set.safetyBufferMl = v;
  }
  if (input.lowStockThresholdMl !== undefined) {
    const v = Math.max(0, Math.round(Number(input.lowStockThresholdMl) || 0));
    set.lowStockThresholdMl = v;
  }
  if (Object.keys(set).length > 0) {
    const updated = await Product.findByIdAndUpdate(
      productId,
      { $set: set },
      { new: true }
    );
    if (!updated) throw ApiError.notFound('Product not found');
  } else {
    const exists = await Product.exists({ _id: productId });
    if (!exists) throw ApiError.notFound('Product not found');
  }
  return getInventorySettings(productId);
}

export { computeStockStatus };
