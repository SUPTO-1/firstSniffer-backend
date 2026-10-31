import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { Product } from '../modules/product/product.model';
import { Order } from '../modules/order/order.model';
import { User } from '../modules/user/user.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { PaymentMethod } from '../modules/paymentMethod/paymentMethod.model';
import {
  createOrder,
  getPaymentTerms,
  recordOrderPayment,
  updatePaymentStatus,
} from '../modules/order/order.service';
import {
  createPaymentMethod,
  listPaymentMethods,
  updatePaymentMethod,
} from '../modules/paymentMethod/paymentMethod.service';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  type TaxonomyFixture,
} from './harness';

/**
 * Admin-configurable advance payment tests.
 *
 * The rule under test: the BACKEND is authoritative. A customer's browser
 * may compute a nice-looking advance breakdown, but the amount that is
 * actually required is recomputed by the server from the stored
 * PaymentMethod config and FROZEN onto the order as an immutable
 * snapshot. A later edit to that config must not rewrite history.
 */

let app: ReturnType<typeof createApp>;
let tax: TaxonomyFixture;

let PRODUCT_ID: string;
let ADMIN_ID: string;

/** The 30ml decant costs ৳1,250 — a round base for percentage maths. */
const PRICE_30ML = 1250;

const GUEST_INFO = {
  name: 'Guest Shopper',
  phone: '01799999999',
  email: 'guest@example.com',
  label: 'Home',
  district: 'Chattogram',
  area: 'Gulshan',
  address: 'House 9, Road 9, Block C',
};

const SHIPPING = {
  label: 'Home',
  district: 'Chattogram',
  area: 'Chulal',
  address: 'House 12, Road 7',
};

beforeAll(async () => {
  await connectTestDb();
  app = createApp();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearTestDb();
  tax = await seedTaxonomy();

  const product = await Product.create({
    name: 'Dior Sauvage',
    slug: 'dior-sauvage',
    brand: tax.brands.Dior,
    genres: [],
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
      { size: '30ml', price: PRICE_30ML, isActive: true },
    ],
    safetyBufferMl: 0,
    lowStockThresholdMl: 30,
  });
  PRODUCT_ID = String(product._id);

  await InventoryBatch.create({
    product: product._id,
    productName: 'Dior Sauvage',
    sourceBottleSizeMl: 100,
    quantity: 4,
    totalMl: 400,
    remainingMl: 400,
    purchaseCost: 15000,
    purchaseDate: new Date(),
    supplier: 'Test',
    notes: '',
    isActive: true,
  });

  /**
   * A customer row exists so the order can be placed against a real
   * account — but these tests exercise GUEST-style ordering (the public
   * create-order path), so the customer id itself is never needed.
   */
  await User.create({
    name: 'Test Customer',
    email: 'cust@example.com',
    phone: '01700000000',
    password: 'hashed-placeholder',
    role: 'customer',
    isGuest: false,
    isActive: true,
    addresses: [],
  });

  const admin = await User.create({
    name: 'Test Admin',
    email: 'admin@example.com',
    phone: '01800000000',
    password: 'hashed-placeholder',
    role: 'admin',
    isGuest: false,
    isActive: true,
    addresses: [],
  });
  ADMIN_ID = String(admin._id);
});

/* ==================================================================
 *  Helpers
 * ================================================================== */

/** Create a payment method with the given advance configuration. */
async function makeMethod(
  name: string,
  advancePaymentRequired: boolean,
  advancePaymentPercent: number,
  extra: Record<string, unknown> = {}
) {
  const method = await PaymentMethod.create({
    name,
    type: 'bkash',
    accountNumber: '01700000000',
    accountName: 'First Sniffer',
    instructions: ['Send to the personal number', 'Share the TrxID'],
    displayOrder: 0,
    isActive: true,
    advancePaymentRequired,
    advancePaymentPercent,
    ...extra,
  });
  return String(method._id);
}

/** Place a guest order for one 30ml bottle using the given method. */
async function placeOrder(paymentMethodId?: string, quantity = 1) {
  const order = await createOrder({
    guestInfo: GUEST_INFO,
    orderSource: 'online',
    items: [{ product: PRODUCT_ID, size: '30ml', quantity }],
    shippingAddress: SHIPPING,
    ...(paymentMethodId ? { paymentMethod: paymentMethodId } : {}),
  }, ADMIN_ID);
  return order;
}

/**
 * The order total INCLUDES the shipping charge, so it is not simply the
 * item price. Every percentage assertion below is therefore expressed
 * against the order's own total rather than a hardcoded figure — that
 * way the test states the RULE (a percentage OF the total) rather than
 * a number that happens to be right today.
 */

/* ==================================================================
 *  PaymentMethod configuration
 * ================================================================== */

describe('PaymentMethod advance configuration', () => {
  it('defaults to NO advance for a brand-new method', async () => {
    const method = await PaymentMethod.create({
      name: 'Cash on Delivery',
      type: 'cod',
    });
    expect(method.advancePaymentRequired).toBe(false);
    expect(method.advancePaymentPercent).toBe(0);
  });

  it('leaves an EXISTING record (created before the feature) forcing no advance', async () => {
    // A document written before `advancePaymentRequired` existed has the
    // field ABSENT. It must read as "no advance required".
    await PaymentMethod.collection.insertOne({
      name: 'Legacy bKash',
      type: 'bkash',
      accountNumber: '01700000000',
      accountName: 'Legacy',
      instructions: [],
      displayOrder: 0,
      isActive: true,
    } as never);

    const legacy = await PaymentMethod.findOne({ name: 'Legacy bKash' }).exec();
    expect(legacy!.advancePaymentRequired).toBe(false);
    expect(legacy!.advancePaymentPercent).toBe(0);
  });

  it('exposes the advance config on the public shape', async () => {
    const id = await makeMethod('bKash', true, 30);
    const list = await listPaymentMethods({ page: '1', limit: '50' } as never);
    /**
     * The list route renames `_id` → `id` at runtime (see
     * `executePagedQuery`), but the generic type is `IPaymentMethod`,
     * which does not declare that field. The cast reflects what the
     * route actually returns.
     */
    const method = (
      list.results as unknown as { id: string; advancePaymentRequired: boolean; advancePaymentPercent: number }[]
    ).find((m) => m.id === id);
    expect(method).toBeTruthy();
    expect(method!.advancePaymentRequired).toBe(true);
    expect(method!.advancePaymentPercent).toBe(30);
  });

  it('rejects a percentage of 0 when the advance is ENABLED', async () => {
    await expect(
      createPaymentMethod({
        name: 'Bad Method',
        type: 'bkash',
        advancePaymentRequired: true,
        advancePaymentPercent: 0,
      } as never)
    ).rejects.toThrow();
  });

  it('rejects a NEGATIVE percentage', async () => {
    await expect(
      createPaymentMethod({
        name: 'Bad Method',
        type: 'bkash',
        advancePaymentRequired: true,
        advancePaymentPercent: -10,
      } as never)
    ).rejects.toThrow();
  });

  it('rejects a percentage ABOVE 100', async () => {
    await expect(
      createPaymentMethod({
        name: 'Bad Method',
        type: 'bkash',
        advancePaymentRequired: true,
        advancePaymentPercent: 101,
      } as never)
    ).rejects.toThrow();
  });

  it('ALLOWS a percentage of exactly 100', async () => {
    const created = await createPaymentMethod({
      name: 'Full Advance',
      type: 'bkash',
      advancePaymentRequired: true,
      advancePaymentPercent: 100,
    } as never);
    expect(created.advancePaymentPercent).toBe(100);
  });

  it('ALLOWS a zero percentage when the advance is DISABLED', async () => {
    const created = await createPaymentMethod({
      name: 'No Advance',
      type: 'cod',
      advancePaymentRequired: false,
      advancePaymentPercent: 0,
    } as never);
    expect(created.advancePaymentRequired).toBe(false);
  });

  it('rejects turning the advance ON without a percentage', async () => {
    const id = await makeMethod('Existing', false, 0);
    await expect(
      updatePaymentMethod(id, { advancePaymentRequired: true } as never)
    ).rejects.toThrow();
  });

  it('rejects setting the percentage to 0 while the advance stays ON', async () => {
    const id = await makeMethod('Existing', true, 30);
    await expect(
      updatePaymentMethod(id, { advancePaymentPercent: 0 } as never)
    ).rejects.toThrow();
  });

  it('allows a partial update that does NOT touch the advance fields', async () => {
    const id = await makeMethod('Existing', true, 30);
    const updated = await updatePaymentMethod(id, { name: 'Renamed' } as never);
    expect(updated.name).toBe('Renamed');
    expect(updated.advancePaymentPercent).toBe(30);
  });

  it('allows turning the advance OFF in one step', async () => {
    const id = await makeMethod('Existing', true, 30);
    const updated = await updatePaymentMethod(id, {
      advancePaymentRequired: false,
      advancePaymentPercent: 0,
    } as never);
    expect(updated.advancePaymentRequired).toBe(false);
  });
});

/* ==================================================================
 *  Snapshot at order creation
 * ================================================================== */

describe('Order creation snapshots the advance terms', () => {
  it('records the method, percentage, advance and remainder on the order', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);

    const snapshot = order.paymentSnapshot;
    expect(snapshot).toBeTruthy();
    expect(snapshot!.methodName).toBe('bKash');
    expect(snapshot!.methodType).toBe('bkash');
    expect(snapshot!.advanceRequired).toBe(true);
    expect(snapshot!.advancePercent).toBe(30);
    // 30% of the order total, rounded to a whole taka.
    expect(snapshot!.advanceAmount).toBe(Math.round(order.total * 0.3));
    expect(snapshot!.remainingOnDelivery).toBe(order.total - snapshot!.advanceAmount);
    expect(snapshot!.totalAmount).toBe(order.total);
  });

  it('freezes the account number and instructions onto the order', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);

    expect(order.paymentSnapshot!.accountNumber).toBe('01700000000');
    expect(order.paymentSnapshot!.accountName).toBe('First Sniffer');
    expect(order.paymentSnapshot!.instructions).toEqual([
      'Send to the personal number',
      'Share the TrxID',
    ]);
  });

  it('records NO advance and a FULL remainder when the method disables it', async () => {
    const methodId = await makeMethod('Cash on Delivery', false, 0);
    const order = await placeOrder(methodId);

    expect(order.paymentSnapshot!.advanceRequired).toBe(false);
    expect(order.paymentSnapshot!.advancePercent).toBe(0);
    expect(order.paymentSnapshot!.advanceAmount).toBe(0);
    expect(order.paymentSnapshot!.remainingOnDelivery).toBe(order.total);
  });

  it('IGNORES the percentage when the advance is DISABLED', async () => {
    // A stray percentage left over from an earlier configuration must
    // not sneak into the maths.
    const methodId = await makeMethod('No Advance Method', false, 50);
    const order = await placeOrder(methodId);

    expect(order.paymentSnapshot!.advanceAmount).toBe(0);
    expect(order.paymentSnapshot!.remainingOnDelivery).toBe(order.total);
  });

  it('computes 10% correctly', async () => {
    const methodId = await makeMethod('Ten', true, 10);
    const order = await placeOrder(methodId);
    expect(order.paymentSnapshot!.advanceAmount).toBe(
      Math.round(order.total * 0.1)
    );
  });

  it('computes 20% correctly', async () => {
    const methodId = await makeMethod('Twenty', true, 20);
    const order = await placeOrder(methodId);
    expect(order.paymentSnapshot!.advanceAmount).toBe(
      Math.round(order.total * 0.2)
    );
  });

  it('computes 30% correctly', async () => {
    const methodId = await makeMethod('Thirty', true, 30);
    const order = await placeOrder(methodId);
    expect(order.paymentSnapshot!.advanceAmount).toBe(
      Math.round(order.total * 0.3)
    );
  });

  it('computes 50% correctly', async () => {
    const methodId = await makeMethod('Fifty', true, 50);
    const order = await placeOrder(methodId);
    expect(order.paymentSnapshot!.advanceAmount).toBe(
      Math.round(order.total * 0.5)
    );
  });

  it('computes 100% correctly — nothing left on delivery', async () => {
    const methodId = await makeMethod('Full', true, 100);
    const order = await placeOrder(methodId);
    expect(order.paymentSnapshot!.advanceAmount).toBe(order.total);
    expect(order.paymentSnapshot!.remainingOnDelivery).toBe(0);
  });

  it('rounds the advance to the nearest WHOLE taka', async () => {
    const methodId = await makeMethod('Rounding', true, 30);
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '10ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: methodId,
    }, ADMIN_ID);
    // The advance is a whole number of taka — never a fraction.
    expect(Number.isInteger(order.paymentSnapshot!.advanceAmount)).toBe(true);
    expect(order.paymentSnapshot!.advanceAmount).toBe(
      Math.round(order.total * 0.3)
    );
    // The remainder is also whole.
    expect(Number.isInteger(order.paymentSnapshot!.remainingOnDelivery)).toBe(
      true
    );
  });

  it('supports DIFFERENT percentages on DIFFERENT methods', async () => {
    const bkash = await makeMethod('bKash', true, 30);
    const nagad = await makeMethod('Nagad', true, 50);

    const a = await placeOrder(bkash);
    const b = await placeOrder(nagad);

    expect(a.paymentSnapshot!.advanceAmount).toBe(
      Math.round(a.total * 0.3)
    );
    expect(b.paymentSnapshot!.advanceAmount).toBe(
      Math.round(b.total * 0.5)
    );
    // The two methods really do demand different amounts.
    expect(b.paymentSnapshot!.advanceAmount).toBeGreaterThan(
      a.paymentSnapshot!.advanceAmount
    );
  });

  it('leaves the snapshot EMPTY when no method was chosen', async () => {
    const order = await placeOrder(undefined);
    expect(order.paymentSnapshot ?? null).toBeNull();
  });
});

/* ==================================================================
 *  The backend is authoritative
 * ================================================================== */

describe('The backend ignores anything the client claims', () => {
  it('rejects a client-supplied advanceAmount as an unknown field', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const res = await request(app).post('/api/orders').send({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: methodId,
      // A client trying to dictate the amount.
      advanceAmount: 1,
    });

    // The schema is strict — the extra key is rejected outright.
    expect(res.status).toBe(400);
  });

  it('rejects a client-supplied advancePercent as an unknown field', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const res = await request(app).post('/api/orders').send({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: methodId,
      advancePercent: 1,
    });

    expect(res.status).toBe(400);
  });

  it('rejects a client-supplied paymentSnapshot as an unknown field', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const res = await request(app).post('/api/orders').send({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: methodId,
      paymentSnapshot: { advanceAmount: 0, advancePercent: 0 },
    });

    expect(res.status).toBe(400);
  });

  it('recomputes from the STORED method, not from anything in the request', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);

    // The stored method says 30% — so does the snapshot, regardless of
    // anything the client might have wanted.
    const stored = await PaymentMethod.findById(methodId).lean().exec();
    expect(stored!.advancePaymentPercent).toBe(30);
    expect(order.paymentSnapshot!.advancePercent).toBe(30);
    expect(order.paymentSnapshot!.advanceAmount).toBe(
      Math.round(order.total * 0.3)
    );
  });
});

/* ==================================================================
 *  Historical orders never change
 * ================================================================== */

describe('A later config change does NOT rewrite history', () => {
  it('keeps the original snapshot when the admin edits the method', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);
    const orderId = order.id;
    const originalAdvance = order.paymentSnapshot!.advanceAmount;

    // The admin changes the rule to 50%.
    await PaymentMethod.updateOne(
      { _id: methodId },
      { $set: { advancePaymentPercent: 50, advancePaymentRequired: true } }
    ).exec();

    const stored = await Order.findById(orderId).lean().exec();
    expect(stored!.paymentSnapshot!.advancePercent).toBe(30);
    expect(stored!.paymentSnapshot!.advanceAmount).toBe(originalAdvance);
    expect(stored!.paymentSnapshot!.remainingOnDelivery).toBe(
      order.total - originalAdvance
    );
  });

  it('keeps the original snapshot when the admin DISABLES the advance', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);
    const originalAdvance = order.paymentSnapshot!.advanceAmount;

    await PaymentMethod.updateOne(
      { _id: methodId },
      { $set: { advancePaymentRequired: false, advancePaymentPercent: 0 } }
    ).exec();

    const stored = await Order.findById(order.id).lean().exec();
    expect(stored!.paymentSnapshot!.advanceRequired).toBe(true);
    expect(stored!.paymentSnapshot!.advanceAmount).toBe(originalAdvance);
  });

  it('keeps the original snapshot when the admin changes the account number', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);

    await PaymentMethod.updateOne(
      { _id: methodId },
      { $set: { accountNumber: '01999999999' } }
    ).exec();

    const stored = await Order.findById(order.id).lean().exec();
    expect(stored!.paymentSnapshot!.accountNumber).toBe('01700000000');
  });

  it('applies the NEW config to orders created AFTER the change', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    await placeOrder(methodId);

    await PaymentMethod.updateOne(
      { _id: methodId },
      { $set: { advancePaymentPercent: 50 } }
    ).exec();

    const later = await placeOrder(methodId);
    expect(later.paymentSnapshot!.advancePercent).toBe(50);
    expect(later.paymentSnapshot!.advanceAmount).toBe(
      Math.round(later.total * 0.5)
    );
  });
});

/* ==================================================================
 *  Payment verification uses the snapshot
 * ================================================================== */

describe('Payment verification uses the SNAPSHOT, not a fixed 30%', () => {
  it('marks the order PENDING_VERIFICATION when the advance is recorded', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);
    const advance = order.paymentSnapshot!.advanceAmount;

    const updated = await recordOrderPayment(
      order.id,
      { amount: advance, note: 'bKash advance' },
      ADMIN_ID
    );

    expect(updated.order.paymentStatus).toBe('pending_verification');
    expect(updated.order.paidAmount).toBe(advance);
  });

  it('does NOT mark the order fully paid when only the advance is verified', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);
    const advance = order.paymentSnapshot!.advanceAmount;

    const updated = await recordOrderPayment(
      order.id,
      { amount: advance, note: 'bKash advance' },
      ADMIN_ID
    );

    expect(updated.order.paymentStatus).not.toBe('paid');
  });

  it('marks the order PAID only once the FULL total is settled', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);
    const advance = order.paymentSnapshot!.advanceAmount;

    await recordOrderPayment(
      order.id,
      { amount: advance, note: 'advance' },
      ADMIN_ID
    );
    const updated = await recordOrderPayment(
      order.id,
      { amount: order.total - advance, note: 'balance on delivery' },
      ADMIN_ID
    );

    expect(updated.order.paymentStatus).toBe('paid');
    // The payments accumulate, so the total received equals the order
    // total once the order is fully settled.
    expect(updated.order.paidAmount).toBe(order.total);
  });

  it('uses the ACTUAL advance amount, not a hardcoded 30%', async () => {
    const methodId = await makeMethod('Nagad', true, 50);
    const order = await placeOrder(methodId);
    const advance = order.paymentSnapshot!.advanceAmount;
    expect(advance).toBe(Math.round(order.total * 0.5));

    // Recording exactly the snapshot's advance must be accepted as the
    // advance — a hardcoded 30% would leave the order short.
    const updated = await recordOrderPayment(
      order.id,
      { amount: advance, note: 'Nagad advance' },
      ADMIN_ID
    );
    expect(updated.order.paidAmount).toBe(advance);
    expect(updated.order.paymentStatus).toBe('pending_verification');
  });

  it('keeps the full-COD flow unchanged when no advance is required', async () => {
    const methodId = await makeMethod('Cash on Delivery', false, 0);
    const order = await placeOrder(methodId);

    const updated = await recordOrderPayment(
      order.id,
      { amount: order.total, note: 'paid on delivery' },
      ADMIN_ID
    );

    expect(updated.order.paymentStatus).toBe('paid');
    expect(updated.order.paidAmount).toBe(order.total);
  });

  it('setting the status to paid sets the paid amount to the FULL total', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);

    const updated = await updatePaymentStatus(order.id, 'paid');
    expect(updated.paidAmount).toBe(order.total);
    expect(updated.paymentStatus).toBe('paid');
  });

  it('preserves a partial payment when the status flips to something else', async () => {
    const methodId = await makeMethod('bKash', true, 30);
    const order = await placeOrder(methodId);
    const advance = order.paymentSnapshot!.advanceAmount;

    await recordOrderPayment(
      order.id,
      { amount: advance, note: 'advance' },
      ADMIN_ID
    );
    const updated = await updatePaymentStatus(order.id, 'pending_verification');

    expect(updated.paidAmount).toBe(advance);
  });
});

/* ==================================================================
 *  getPaymentTerms — the shared reader
 * ================================================================== */

describe('getPaymentTerms', () => {
  it('reads the advance and the remainder from the snapshot', () => {
    const terms = getPaymentTerms({
      total: 1000,
      paymentSnapshot: {
        methodName: 'bKash',
        methodType: 'bkash',
        advanceRequired: true,
        advancePercent: 30,
        advanceAmount: 300,
        remainingOnDelivery: 700,
        totalAmount: 1000,
        accountNumber: '',
        accountName: '',
        instructions: [],
      },
    });

    expect(terms.advanceRequired).toBe(true);
    expect(terms.advanceAmount).toBe(300);
    expect(terms.remainingOnDelivery).toBe(700);
  });

  it('treats an order with NO snapshot as full payment on delivery', () => {
    const terms = getPaymentTerms({ total: 1000 });
    expect(terms.advanceRequired).toBe(false);
    expect(terms.advanceAmount).toBe(0);
    expect(terms.remainingOnDelivery).toBe(1000);
  });

  it('never lets the advance exceed the order total', () => {
    const terms = getPaymentTerms({
      total: 500,
      paymentSnapshot: {
        methodName: 'bKash',
        methodType: 'bkash',
        advanceRequired: true,
        advancePercent: 100,
        advanceAmount: 9999,
        remainingOnDelivery: 0,
        totalAmount: 500,
        accountNumber: '',
        accountName: '',
        instructions: [],
      },
    });

    expect(terms.advanceAmount).toBe(500);
    expect(terms.remainingOnDelivery).toBe(0);
  });
});
