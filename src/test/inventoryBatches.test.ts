import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { InventoryLog } from '../modules/inventoryLog/inventoryLog.model';
import { Product } from '../modules/product/product.model';
import { Order } from '../modules/order/order.model';
import { User } from '../modules/user/user.model';
// Registered so the idempotency path's `.populate('paymentMethod')` resolves.
import '../modules/paymentMethod/paymentMethod.model';
import {
  consumeFifo,
  createInventoryBatch,
  getProductStock,
  restoreAllocations,
  rollbackConsumption,
} from '../modules/inventory/inventoryBatch.service';
import {
  calculateOrder,
  createOrder,
  updateOrderStatus,
} from '../modules/order/order.service';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  type TaxonomyFixture,
} from './harness';

/**
 * Inventory architecture regression tests.
 *
 * The old model keyed stock on the SELLING size (`bottleSize: '3ml'`), which
 * contradicted the decant business: one 100ml original bottle yields
 * 3/5/10/15/30ml decants drawn from the SAME pool.
 *
 * These tests lock down the new behaviour:
 *
 *   - A 30ml order deducts exactly 30ml (the old bug deducted 1ml).
 *   - Stock is shared across selling sizes.
 *   - Consumption is FIFO across purchase batches.
 *   - A single order line can be assembled across two batches.
 *   - Cancellation restores into the EXACT batches that were debited.
 *   - Concurrent consumption cannot drive stock negative.
 *   - A disabled variant cannot be ordered.
 *   - The safety buffer is actually enforced.
 */

let tax: TaxonomyFixture;

const PRODUCT_IDS: Record<string, string> = {};
const ACTOR_IDS: Record<string, string> = {};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearTestDb();
  tax = await seedTaxonomy();

  // A product with 3/5/10/15/30ml variants, priced per bottle.
  const doc = await Product.create({
    name: 'Dior Sauvage',
    slug: 'dior-sauvage',
    brand: tax.brands.Dior,
    genres: [tax.genres.Fresh],
    notes: { top: [], middle: [], base: [] },
    seasons: [],
    occasions: [],
    weathers: [],
    times: [],
    description: '',
    gender: 'unisex',
    aliases: [],
    isActive: true,
    images: [{ url: 'https://img.test/s.png', fileId: 'file_s' }],
    variants: [
      { size: '3ml', price: 250, isActive: true },
      { size: '5ml', price: 400, isActive: true },
      { size: '10ml', price: 770, isActive: true },
      { size: '15ml', price: 1000, isActive: true },
      { size: '30ml', price: 1250, isActive: true },
    ],
    safetyBufferMl: 0,
    lowStockThresholdMl: 30,
  });
  PRODUCT_IDS.sauvage = String(doc._id);

  // A customer and an admin actor — orders reference both.
  const customer = await User.create({
    name: 'Test Customer',
    nickname: 'cust',
    email: 'cust@example.com',
    phone: '01700000000',
    password: 'hashed-placeholder',
    role: 'customer',
    isGuest: false,
    isActive: true,
    addresses: [],
  });
  ACTOR_IDS.customer = String(customer._id);

  const admin = await User.create({
    name: 'Test Admin',
    nickname: 'admin',
    email: 'admin@example.com',
    phone: '01800000000',
    password: 'hashed-placeholder',
    role: 'admin',
    isGuest: false,
    isActive: true,
    addresses: [],
  });
  ACTOR_IDS.admin = String(admin._id);
});

/** Place a manual order for the fixture product. */
async function placeOrder(
  items: Array<{ product: string; size: '3ml' | '5ml' | '10ml' | '15ml' | '30ml'; quantity: number }>
) {
  return createOrder(
    {
      customer: ACTOR_IDS.customer,
      orderSource: 'manual',
      items,
      shippingAddress: {
        district: 'Chattogram',
        area: 'Gulshan',
        address: 'House 1, Road 2',
      },
    },
    ACTOR_IDS.admin
  );
}

/** Create a batch directly (bypasses the service's product lookup cost). */
async function makeBatch(opts: {
  sourceBottleSizeMl: number;
  quantity: number;
  remainingMl?: number;
  purchaseDate?: Date;
  purchaseCost?: number;
  isActive?: boolean;
}): Promise<string> {
  const totalMl = opts.sourceBottleSizeMl * opts.quantity;
  const batch = await InventoryBatch.create({
    product: PRODUCT_IDS.sauvage,
    productName: 'Dior Sauvage',
    sourceBottleSizeMl: opts.sourceBottleSizeMl,
    quantity: opts.quantity,
    totalMl,
    remainingMl: opts.remainingMl ?? totalMl,
    purchaseCost: opts.purchaseCost ?? 0,
    purchaseDate: opts.purchaseDate ?? new Date(),
    supplier: '',
    notes: '',
    isActive: opts.isActive ?? true,
  });
  return String(batch._id);
}

async function remainingOf(batchId: string): Promise<number> {
  const b = await InventoryBatch.findById(batchId).lean();
  return Number((b as unknown as { remainingMl: number }).remainingMl);
}

/* ==================================================================
 *  Product-level aggregation
 * ================================================================== */

describe('Product-level stock aggregation', () => {
  it('sums totalMl and remainingMl across every active batch', async () => {
    await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 }); // 100ml
    await makeBatch({ sourceBottleSizeMl: 50, quantity: 2 }); // 100ml

    const stock = await getProductStock(PRODUCT_IDS.sauvage);

    expect(stock.totalMl).toBe(200);
    expect(stock.remainingMl).toBe(200);
    expect(stock.batchCount).toBe(2);
    expect(stock.status).toBe('in_stock');
  });

  it('excludes retired batches from the total', async () => {
    await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });
    await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      isActive: false,
    });

    const stock = await getProductStock(PRODUCT_IDS.sauvage);

    expect(stock.totalMl).toBe(100);
    expect(stock.batchCount).toBe(1);
  });

  it('subtracts the product-level safety buffer from sellable stock', async () => {
    await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });
    await Product.updateOne(
      { _id: PRODUCT_IDS.sauvage },
      { $set: { safetyBufferMl: 10, lowStockThresholdMl: 30 } }
    );

    const stock = await getProductStock(PRODUCT_IDS.sauvage);

    expect(stock.remainingMl).toBe(100);
    expect(stock.safetyBufferMl).toBe(10);
    expect(stock.sellableMl).toBe(90);
  });

  it('reports low_stock when sellable ml falls to the threshold', async () => {
    await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 30,
    });
    await Product.updateOne(
      { _id: PRODUCT_IDS.sauvage },
      { $set: { safetyBufferMl: 0, lowStockThresholdMl: 30 } }
    );

    const stock = await getProductStock(PRODUCT_IDS.sauvage);

    expect(stock.status).toBe('low_stock');
  });

  it('reports out_of_stock when nothing is sellable', async () => {
    await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 5,
    });
    await Product.updateOne(
      { _id: PRODUCT_IDS.sauvage },
      { $set: { safetyBufferMl: 10, lowStockThresholdMl: 30 } }
    );

    const stock = await getProductStock(PRODUCT_IDS.sauvage);

    expect(stock.sellableMl).toBe(0);
    expect(stock.status).toBe('out_of_stock');
  });
});

/* ==================================================================
 *  FIFO consumption
 * ================================================================== */

describe('FIFO consumption', () => {
  it('draws from the oldest batch first', async () => {
    const older = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      purchaseDate: new Date('2026-01-01'),
    });
    const newer = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      purchaseDate: new Date('2026-06-01'),
    });

    const allocations = await consumeFifo(PRODUCT_IDS.sauvage, 30);

    expect(allocations).toHaveLength(1);
    expect(allocations[0].batch).toBe(older);
    expect(allocations[0].millilitres).toBe(30);
    expect(await remainingOf(older)).toBe(70);
    expect(await remainingOf(newer)).toBe(100);
  });

  it('assembles one line across two batches', async () => {
    const first = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 12,
      purchaseDate: new Date('2026-01-01'),
    });
    const second = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      purchaseDate: new Date('2026-06-01'),
    });

    const allocations = await consumeFifo(PRODUCT_IDS.sauvage, 30);

    expect(allocations).toHaveLength(2);
    expect(allocations[0]).toEqual({ batch: first, millilitres: 12 });
    expect(allocations[1]).toEqual({ batch: second, millilitres: 18 });
    expect(await remainingOf(first)).toBe(0);
    expect(await remainingOf(second)).toBe(82);
  });

  it('throws when the product does not have enough liquid', async () => {
    await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 10,
    });

    await expect(consumeFifo(PRODUCT_IDS.sauvage, 30)).rejects.toThrow(
      /Insufficient stock/i
    );
  });

  it('never drives a batch negative under concurrent consumption', async () => {
    const batch = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 50,
    });

    // Two concurrent 30ml draws against a 50ml batch: one must win, one must
    // fail — but the batch must never go below zero.
    const results = await Promise.allSettled([
      consumeFifo(PRODUCT_IDS.sauvage, 30),
      consumeFifo(PRODUCT_IDS.sauvage, 30),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(await remainingOf(batch)).toBe(20);
    expect(await remainingOf(batch)).toBeGreaterThanOrEqual(0);
  });

  it('writes one batch-level log row per consumed batch', async () => {
    const first = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 12,
      purchaseDate: new Date('2026-01-01'),
    });
    const second = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      purchaseDate: new Date('2026-06-01'),
    });

    await consumeFifo(PRODUCT_IDS.sauvage, 30, { referenceId: 'order-1' });

    const logs = await InventoryLog.find({ type: 'sale' }).lean();
    expect(logs).toHaveLength(2);
    const batchIds = logs.map(
      (l) => String((l as unknown as { inventory: { toString(): string } }).inventory)
    );
    expect(batchIds).toContain(first);
    expect(batchIds).toContain(second);
  });
});

/* ==================================================================
 *  Restoration
 * ================================================================== */

describe('Restoration and reversal', () => {
  it('restores into the exact batches that were debited', async () => {
    const first = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 12,
      purchaseDate: new Date('2026-01-01'),
    });
    const second = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      purchaseDate: new Date('2026-06-01'),
    });

    const allocations = await consumeFifo(PRODUCT_IDS.sauvage, 30);
    expect(await remainingOf(first)).toBe(0);
    expect(await remainingOf(second)).toBe(82);

    await restoreAllocations(allocations, { referenceId: 'order-1' });

    expect(await remainingOf(first)).toBe(12);
    expect(await remainingOf(second)).toBe(100);
  });

  it('does NOT inflate totalMl when reversing a sale', async () => {
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    const allocations = await consumeFifo(PRODUCT_IDS.sauvage, 30);
    await restoreAllocations(allocations);

    const b = await InventoryBatch.findById(batch).lean();
    expect((b as unknown as { totalMl: number }).totalMl).toBe(100);
    expect((b as unknown as { remainingMl: number }).remainingMl).toBe(100);
  });

  it('writes a reversal log row', async () => {
    await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });
    const allocations = await consumeFifo(PRODUCT_IDS.sauvage, 30);
    await restoreAllocations(allocations, { referenceId: 'order-1' });

    const logs = await InventoryLog.find({ type: 'reversal' }).lean();
    expect(logs).toHaveLength(1);
    expect(
      Number((logs[0] as unknown as { quantityMl: number }).quantityMl)
    ).toBe(30);
  });

  it('rolls back a partially-consumed order without leaking stock', async () => {
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    const allocations = await consumeFifo(PRODUCT_IDS.sauvage, 30);
    await rollbackConsumption(allocations);

    expect(await remainingOf(batch)).toBe(100);
  });
});

/* ==================================================================
 *  Order path — the millilitre maths
 * ================================================================== */

describe('Order path — backend-owned millilitre maths', () => {
  it('a 30ml order deducts exactly 30ml, not 1ml', async () => {
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 },
    ]);

    expect(await remainingOf(batch)).toBe(70);
  });

  it('a 3ml × 4 order deducts exactly 12ml', async () => {
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '3ml', quantity: 4 },
    ]);

    expect(await remainingOf(batch)).toBe(88);
  });

  it('sizes draw from the SAME product pool', async () => {
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '3ml', quantity: 1 },
    ]);
    await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 },
    ]);

    // 100 - 3 - 30 = 67
    expect(await remainingOf(batch)).toBe(67);
  });

  it('calculateOrder prices per bottle and reports derived ml', async () => {
    await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    const res = await calculateOrder({
      items: [{ product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 2 }],
      shippingZone: 'inside-ctg',
    });

    expect(res.items[0].millilitres).toBe(60);
    expect(res.items[0].unitPrice).toBe(1250);
    expect(res.items[0].totalPrice).toBe(2500);
    expect(res.items[0].availableMl).toBe(100);
    expect(res.items[0].inStock).toBe(true);
  });

  it('calculateOrder rejects a disabled variant', async () => {
    await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });
    await Product.updateOne(
      { _id: PRODUCT_IDS.sauvage },
      { $set: { 'variants.1.isActive': false } } // 5ml
    );

    await expect(
      calculateOrder({
        items: [{ product: PRODUCT_IDS.sauvage, size: '5ml', quantity: 1 }],
        shippingZone: 'inside-ctg',
      })
    ).rejects.toThrow(/not (available|sellable|active)/i);
  });

  it('calculateOrder reports insufficient stock across all batches', async () => {
    await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 20,
    });

    const res = await calculateOrder({
      items: [{ product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 }],
      shippingZone: 'inside-ctg',
    });

    expect(res.items[0].inStock).toBe(false);
  });

  it('the safety buffer reduces what calculateOrder says is available', async () => {
    await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });
    await Product.updateOne(
      { _id: PRODUCT_IDS.sauvage },
      { $set: { safetyBufferMl: 40 } }
    );

    const res = await calculateOrder({
      items: [{ product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 }],
      shippingZone: 'inside-ctg',
    });

    expect(res.items[0].availableMl).toBe(60);
    expect(res.items[0].inStock).toBe(true);
  });
});

/* ==================================================================
 *  Order cancellation — exact-batch restoration
 * ================================================================== */

describe('Order cancellation', () => {
  it('restores stock into the exact batches that were debited', async () => {
    const first = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 12,
      purchaseDate: new Date('2026-01-01'),
    });
    const second = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      purchaseDate: new Date('2026-06-01'),
    });

    const order = await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 },
    ]);

    // The 30ml line was assembled from 12ml + 18ml across two bottles.
    expect(await remainingOf(first)).toBe(0);
    expect(await remainingOf(second)).toBe(82);

    await updateOrderStatus(order.id, 'cancelled', ACTOR_IDS.admin, 'test');

    // Restored into the SAME bottles, not an arbitrary one.
    expect(await remainingOf(first)).toBe(12);
    expect(await remainingOf(second)).toBe(100);
  });

  it('does not inflate totalMl when an order is cancelled', async () => {
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    const order = await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 },
    ]);
    await updateOrderStatus(order.id, 'cancelled', ACTOR_IDS.admin, 'test');

    const b = await InventoryBatch.findById(batch).lean();
    expect((b as unknown as { totalMl: number }).totalMl).toBe(100);
    expect((b as unknown as { remainingMl: number }).remainingMl).toBe(100);
  });

  it('restores only once, even if cancel is requested twice', async () => {
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    const order = await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 },
    ]);

    await updateOrderStatus(order.id, 'cancelled', ACTOR_IDS.admin, 'test');
    // The second cancel is rejected by the status machine, and even if it
    // were not, the atomic `inventoryReversed` claim prevents a double credit.
    await expect(
      updateOrderStatus(order.id, 'cancelled', ACTOR_IDS.admin, 'again')
    ).rejects.toThrow();

    expect(await remainingOf(batch)).toBe(100);
  });

  it('records the stock allocations on the order line', async () => {
    const first = await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      remainingMl: 12,
      purchaseDate: new Date('2026-01-01'),
    });
    await makeBatch({
      sourceBottleSizeMl: 100,
      quantity: 1,
      purchaseDate: new Date('2026-06-01'),
    });

    await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 },
    ]);

    const doc = await Order.findOne().lean();
    const item = (
      doc as unknown as {
        items: Array<{
          stockAllocations?: Array<{ batch: unknown; millilitres: number }>;
        }>;
      }
    ).items[0];

    expect(item.stockAllocations).toHaveLength(2);
    expect(String(item.stockAllocations?.[0].batch)).toBe(first);
    expect(item.stockAllocations?.[0].millilitres).toBe(12);
  });
});

/* ==================================================================
 *  Idempotency
 * ================================================================== */

describe('Order idempotency', () => {
  it('allows many orders that carry NO idempotency key', async () => {
    // Regression: a sparse unique index only skips ABSENT fields. Storing an
    // explicit `null` would make the second order collide (E11000).
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });

    await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '3ml', quantity: 1 },
    ]);
    await placeOrder([
      { product: PRODUCT_IDS.sauvage, size: '3ml', quantity: 1 },
    ]);

    expect(await remainingOf(batch)).toBe(94);
    expect(await Order.countDocuments()).toBe(2);
  });

  it('a retried request with the same key returns the original order', async () => {
    const batch = await makeBatch({ sourceBottleSizeMl: 100, quantity: 1 });
    const key = 'retry-key-1';

    const first = await createOrder(
      {
        customer: ACTOR_IDS.customer,
        orderSource: 'manual',
        items: [{ product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 }],
        shippingAddress: {
          district: 'Chattogram',
          area: 'Gulshan',
          address: 'House 1, Road 2',
        },
        idempotencyKey: key,
      },
      ACTOR_IDS.admin
    );
    const second = await createOrder(
      {
        customer: ACTOR_IDS.customer,
        orderSource: 'manual',
        items: [{ product: PRODUCT_IDS.sauvage, size: '30ml', quantity: 1 }],
        shippingAddress: {
          district: 'Chattogram',
          area: 'Gulshan',
          address: 'House 1, Road 2',
        },
        idempotencyKey: key,
      },
      ACTOR_IDS.admin
    );

    expect(second.id).toBe(first.id);
    expect(await Order.countDocuments()).toBe(1);
    // The stock was deducted ONCE, not twice.
    expect(await remainingOf(batch)).toBe(70);
  });
});

/* ==================================================================
 *  Batch creation
 * ================================================================== */

describe('Batch creation', () => {
  it('derives totalMl and initialises remainingMl to it', async () => {
    const product = await Product.findById(PRODUCT_IDS.sauvage).lean();

    const batch = await createInventoryBatch({
      product: String((product as unknown as { _id: { toString(): string } })._id),
      sourceBottleSizeMl: 100,
      quantity: 2,
      purchaseCost: 15000,
    });

    expect(batch.sourceBottleSizeMl).toBe(100);
    expect(batch.quantity).toBe(2);
    expect(batch.totalMl).toBe(200);
    expect(batch.remainingMl).toBe(200);
    expect(batch.purchaseCost).toBe(15000);
  });

  it('rejects a non-positive bottle size or quantity', async () => {
    await expect(
      createInventoryBatch({
        product: PRODUCT_IDS.sauvage,
        sourceBottleSizeMl: 0,
        quantity: 1,
        purchaseCost: 0,
      })
    ).rejects.toThrow();

    await expect(
      createInventoryBatch({
        product: PRODUCT_IDS.sauvage,
        sourceBottleSizeMl: 100,
        quantity: 0,
        purchaseCost: 0,
      })
    ).rejects.toThrow();
  });
});
