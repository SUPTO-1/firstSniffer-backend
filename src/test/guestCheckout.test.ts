import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { Product } from '../modules/product/product.model';
import { Order } from '../modules/order/order.model';
import { User } from '../modules/user/user.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { InventoryLog } from '../modules/inventoryLog/inventoryLog.model';
import '../modules/paymentMethod/paymentMethod.model';
import '../modules/combo/combo.model';
import '../modules/coupon/coupon.model';
import '../modules/settings/settings.model';
import { createOrder, updateOrderStatus } from '../modules/order/order.service';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  type TaxonomyFixture,
} from './harness';

/**
 * Guest checkout tests.
 *
 * Before this work, `POST /api/orders` sat behind `router.use(authRequired)`
 * and the storefront aborted client-side when no user was signed in. Both
 * layers are covered here:
 *
 *   - HTTP-level tests prove the ROUTE accepts an anonymous guest order and
 *     still rejects the attacks (no identity at all, mismatched customer,
 *     both `customer` and `guestInfo`).
 *   - Service-level tests prove the DATA is right: a guest User row is
 *     created, the order keeps an immutable `guestInfo` snapshot, the
 *     public token is high-entropy, and `createdBy` is NOT impersonated.
 *   - Inventory tests prove the stock machinery is untouched: a guest order
 *     deducts FIFO and a cancellation restores it exactly.
 */

let app: ReturnType<typeof createApp>;
let tax: TaxonomyFixture;

let PRODUCT_ID: string;
let CUSTOMER_ID: string;
let ADMIN_ID: string;

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
      { size: '30ml', price: 1250, isActive: true },
    ],
    safetyBufferMl: 0,
    lowStockThresholdMl: 30,
  });
  PRODUCT_ID = String(product._id);

  await InventoryBatch.create({
    product: product._id,
    productName: 'Dior Sauvage',
    sourceBottleSizeMl: 100,
    quantity: 1,
    totalMl: 100,
    remainingMl: 100,
    purchaseCost: 15000,
    purchaseDate: new Date(),
    supplier: 'Test',
    notes: '',
    isActive: true,
  });

  const customer = await User.create({
    name: 'Test Customer',
    email: 'cust@example.com',
    phone: '01700000000',
    password: 'hashed-placeholder',
    role: 'customer',
    isGuest: false,
    isActive: true,
    addresses: [],
  });
  CUSTOMER_ID = String(customer._id);

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
 *  Route-level behaviour (HTTP)
 * ================================================================== */

describe('POST /api/orders — guest checkout at the route boundary', () => {
  it('accepts an order from an ANONYMOUS guest', async () => {
    const res = await request(app).post('/api/orders').send({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
    });

    expect(res.status).toBe(201);
    expect(res.body?.data?.orderNumber).toBeTruthy();
    expect(res.body?.data?.isGuestOrder).toBe(true);
  });

  it('rejects a request with NO identity at all (neither customer nor guestInfo)', async () => {
    const res = await request(app).post('/api/orders').send({
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/guest details are required/i);
  });

  it('rejects a body carrying BOTH customer and guestInfo (ambiguous)', async () => {
    const res = await request(app).post('/api/orders').send({
      customer: CUSTOMER_ID,
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/not both/i);
  });

  it('rejects a guest order with an INVALID phone number', async () => {
    const res = await request(app).post('/api/orders').send({
      guestInfo: { ...GUEST_INFO, phone: '12345' },
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
    });

    expect(res.status).toBe(400);
  });

  it('rejects a guest order missing the required guest name', async () => {
    const res = await request(app).post('/api/orders').send({
      guestInfo: { ...GUEST_INFO, name: '' },
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
    });

    expect(res.status).toBe(400);
  });

  it('still rejects an ANONYMOUS request that names somebody else as customer', async () => {
    // Without a token the guard must not let an unauthenticated caller
    // place an order against an arbitrary customer id.
    const res = await request(app).post('/api/orders').send({
      customer: CUSTOMER_ID,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
    });

    expect(res.status).toBe(401);
  });
});

/* ==================================================================
 *  Guest identity + data shape
 * ================================================================== */

describe('Guest identity and order data', () => {
  it('creates a guest User row (isGuest true, no password) and links it', async () => {
    const order = await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      '' // no authenticated actor
    );

    const doc = await Order.findOne({ orderNumber: order.orderNumber }).exec();
    expect(doc).not.toBeNull();
    expect(doc!.guestInfo?.name).toBe(GUEST_INFO.name);
    expect(doc!.guestInfo?.phone).toBe(GUEST_INFO.phone);
    expect(doc!.customer).toBeTruthy();

    const guestUser = await User.findById(doc!.customer).exec();
    expect(guestUser).not.toBeNull();
    expect(guestUser!.isGuest).toBe(true);
    expect(guestUser!.role).toBe('customer');
    // A guest must NEVER be able to log in — the password is null.
    expect(guestUser!.password ?? null).toBeNull();
  });

  it('reuses the SAME guest user row for repeat orders from the same phone', async () => {
    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '5ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );
    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '5ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    const guests = await User.find({ phone: GUEST_INFO.phone, isGuest: true }).exec();
    expect(guests).toHaveLength(1);
  });

  it('supports TWO guests who both omit their email', async () => {
    // REGRESSION: the users collection has a `unique + sparse` index on
    // `email`. A MongoDB sparse index skips documents where the field is
    // ABSENT — but NOT an explicit `null`. If the guest row were written
    // with `email: null`, the SECOND email-less guest would fail with
    // E11000 and their checkout would break.
    const guestA = { ...GUEST_INFO, phone: '01711110001', email: undefined };
    const guestB = { ...GUEST_INFO, phone: '01711110002', email: undefined };

    const a = await createOrder(
      {
        guestInfo: guestA,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '5ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );
    const b = await createOrder(
      {
        guestInfo: guestB,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '5ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    expect(a.orderNumber).toBeTruthy();
    expect(b.orderNumber).toBeTruthy();
    expect(a.orderNumber).not.toBe(b.orderNumber);

    const guests = await User.find({
      phone: { $in: [guestA.phone, guestB.phone] },
      isGuest: true,
    }).exec();
    expect(guests).toHaveLength(2);

    // The email must be ABSENT from the stored document, not null.
    const raw = await User.collection
      .find({ _id: { $in: guests.map((g) => g._id) } })
      .toArray();
    for (const doc of raw) {
      expect('email' in doc).toBe(false);
    }
  });

  it('does NOT attach a guest order to a REGISTERED account sharing the phone', async () => {
    // The customer fixture has phone 01700000000. A guest order using that
    // same phone must create its OWN guest row — never reuse the
    // registered account. Auto-merging on an unverified phone match would
    // let a stranger see someone else's order history.
    const registered = await User.findById(CUSTOMER_ID).exec();
    await User.updateOne(
      { _id: CUSTOMER_ID },
      { $set: { phone: GUEST_INFO.phone } }
    );
    expect(registered).not.toBeNull();

    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '5ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    const guestOrders = await Order.find({ 'guestInfo.phone': GUEST_INFO.phone }).exec();
    expect(guestOrders).toHaveLength(1);
    expect(String(guestOrders[0].customer)).not.toBe(CUSTOMER_ID);

    const guestUser = await User.findById(guestOrders[0].customer).exec();
    expect(guestUser!.isGuest).toBe(true);
  });

  it('stores an IMMUTABLE guestInfo snapshot on the order', async () => {
    const order = await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    const doc = await Order.findOne({ orderNumber: order.orderNumber }).exec();
    const guestUser = await User.findById(doc!.customer).exec();

    // Change the guest account — the order snapshot must NOT follow it.
    await User.updateOne(
      { _id: doc!.customer },
      { $set: { name: 'Renamed Later', phone: '01855555555' } }
    );

    const reread = await Order.findOne({ orderNumber: order.orderNumber }).exec();
    expect(reread!.guestInfo?.name).toBe(GUEST_INFO.name);
    expect(reread!.guestInfo?.phone).toBe(GUEST_INFO.phone);
    expect(guestUser).not.toBeNull();
  });

  it('leaves createdBy ABSENT for a guest order — never an admin', async () => {
    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      '' // no actor
    );

    const doc = await Order.findOne({ 'guestInfo.phone': GUEST_INFO.phone }).exec();
    expect(doc!.createdBy ?? null).toBeNull();
    expect(String(doc!.createdBy ?? '')).not.toBe(ADMIN_ID);
  });

  it('stamps createdBy for an ADMIN manual order (unchanged behaviour)', async () => {
    await createOrder(
      {
        customer: CUSTOMER_ID,
        orderSource: 'manual',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ADMIN_ID
    );

    const doc = await Order.findOne({ customer: CUSTOMER_ID }).exec();
    expect(String(doc!.createdBy)).toBe(ADMIN_ID);
    expect(doc!.guestInfo ?? null).toBeNull();
  });

  it('stamps createdBy for a REGISTERED customer online order (unchanged)', async () => {
    await createOrder(
      {
        customer: CUSTOMER_ID,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      CUSTOMER_ID
    );

    const doc = await Order.findOne({ customer: CUSTOMER_ID }).exec();
    expect(String(doc!.createdBy)).toBe(CUSTOMER_ID);
  });

  it('mints a high-entropy public token for a guest order', async () => {
    const order = await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    expect(order.publicToken).toMatch(/^[a-f0-9]{32}$/);

    const doc = await Order.findOne({ orderNumber: order.orderNumber }).exec();
    expect(doc!.publicToken).toBe(order.publicToken);
  });

  it('gives DIFFERENT public tokens to different guest orders', async () => {
    const a = await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '5ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );
    const b = await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '5ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );
    expect(a.publicToken).not.toBe(b.publicToken);
  });
});

/* ==================================================================
 *  Public token lookup
 * ================================================================== */

describe('Public order lookup by secure token', () => {
  it('fetches a guest order by its token WITHOUT authentication', async () => {
    const order = await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    const res = await request(app).get(
      `/api/public/orders/track/${order.publicToken}`
    );

    expect(res.status).toBe(200);
    expect(res.body?.data?.orderNumber).toBe(order.orderNumber);
    expect(res.body?.data?.guestInfo?.phone).toBe(GUEST_INFO.phone);
  });

  it('REFUSES the sequential order-number route for a token-bearing order', async () => {
    // The order number is guessable — it must not be a usable capability
    // for an order that has a secure token.
    const order = await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    const res = await request(app).get(
      `/api/public/orders/${encodeURIComponent(order.orderNumber)}`
    );

    expect(res.status).toBe(404);
  });

  it('rejects an invalid token format', async () => {
    const res = await request(app).get('/api/public/orders/track/not-a-token');
    expect(res.status).toBe(400);
  });

  it('404s on an unknown but well-formed token', async () => {
    const res = await request(app).get(
      `/api/public/orders/track/${'a'.repeat(32)}`
    );
    expect(res.status).toBe(404);
  });
});

/* ==================================================================
 *  Rate limiting — the anonymous endpoint is abuse-prone
 * ================================================================== */

describe('Rate limiting on anonymous order creation', () => {
  it('returns 429 (not 400) once the anonymous caller exceeds the limit', async () => {
    // The limiter is per-IP and the window is 60s. This test file makes
    // several anonymous requests, so the bucket may already be partly
    // full — we just need to prove that the response is a proper 429
    // with a Retry-After header rather than a generic 400.
    const statuses: number[] = [];
    let retryAfter: string | null = null;

    for (let i = 0; i < 14; i += 1) {
      const res = await request(app).post('/api/orders').send({
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '5ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      });
      statuses.push(res.status);
      if (res.status === 429 && !retryAfter) {
        retryAfter = res.headers['retry-after'] ?? null;
      }
    }

    expect(statuses).toContain(429);
    // A 429 tells the client to RETRY LATER; a 400 would wrongly say its
    // input was bad. The Retry-After header tells it when to come back.
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  });
});

/* ==================================================================
 *  Inventory — guest orders behave exactly like any other order
 * ================================================================== */

describe('Inventory behaviour for guest orders', () => {
  it('deducts the right millilitres for a guest order', async () => {
    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 2 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    const batch = await InventoryBatch.findOne({ product: PRODUCT_ID }).exec();
    expect(batch!.remainingMl).toBe(40); // 100 - 60
  });

  it('restores the stock EXACTLY when a guest order is cancelled', async () => {
    const order = await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    let batch = await InventoryBatch.findOne({ product: PRODUCT_ID }).exec();
    expect(batch!.remainingMl).toBe(70);

    await updateOrderStatus(order.id, 'cancelled', ADMIN_ID, 'test');

    batch = await InventoryBatch.findOne({ product: PRODUCT_ID }).exec();
    expect(batch!.remainingMl).toBe(100);
    expect(batch!.totalMl).toBe(100); // capacity never changes on a reversal
  });

  it('writes inventory logs with NO actor for a guest order', async () => {
    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    const logs = await InventoryLog.find({ type: 'sale' }).exec();
    expect(logs.length).toBeGreaterThan(0);
    // The log must not blame an admin (or anybody) for a guest's sale.
    for (const log of logs) {
      expect(log.createdBy ?? null).toBeNull();
    }
  });

  it('rejects a guest order when stock is insufficient', async () => {
    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 4 }],
        shippingAddress: SHIPPING,
      },
      ''
    ).catch(() => undefined);

    // 4 × 30ml = 120ml but only 100ml exist — the 4th bottle must fail
    // rather than drive stock negative.
    const batch = await InventoryBatch.findOne({ product: PRODUCT_ID }).exec();
    expect(batch!.remainingMl).toBeGreaterThanOrEqual(0);
  });
});

/* ==================================================================
 *  Payment details (the checkout fix)
 * ================================================================== */

describe('Payment details captured at checkout', () => {
  it('stores the sender mobile and TrxID on the order', async () => {
    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
        paymentDetails: {
          senderMobile: '01711111111',
          transactionId: '9A8B7C6D5E',
        },
      },
      ''
    );

    const doc = await Order.findOne({ 'guestInfo.phone': GUEST_INFO.phone }).exec();
    expect(doc!.paymentDetails?.senderMobile).toBe('01711111111');
    expect(doc!.paymentDetails?.transactionId).toBe('9A8B7C6D5E');
  });

  it('leaves paymentDetails absent when the customer supplied none', async () => {
    await createOrder(
      {
        guestInfo: GUEST_INFO,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: SHIPPING,
      },
      ''
    );

    const doc = await Order.findOne({ 'guestInfo.phone': GUEST_INFO.phone }).exec();
    expect(doc!.paymentDetails ?? null).toBeNull();
  });
});
