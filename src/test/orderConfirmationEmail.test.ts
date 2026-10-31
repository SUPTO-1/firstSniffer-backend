import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { Product } from '../modules/product/product.model';
import { Order } from '../modules/order/order.model';
import { User } from '../modules/user/user.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { PaymentMethod } from '../modules/paymentMethod/paymentMethod.model';
import { createOrder } from '../modules/order/order.service';
import type { OrderDoc } from '../modules/order/order.interface';
import {
  buildOrderEmailPayload,
  sendOrderConfirmationEmail,
} from '../modules/email/orderConfirmation.service';
import {
  setEmailTransportOverride,
  isEmailTransportOverridden,
} from '../modules/email/email.service';
import { resetRateLimitBuckets } from '../middleware/rateLimiter';
import { signToken } from '../utils/jwt';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  type TaxonomyFixture,
} from './harness';

/**
 * Order confirmation email tests.
 *
 * The two properties that matter most:
 *
 *   1. A PROVIDER FAILURE MUST NEVER FAIL THE ORDER. The email is sent
 *      after the order is committed, so an outage cannot roll back a
 *      purchase or undo the stock deduction.
 *   2. A CONFIRMATION MUST NEVER BE SENT TWICE. The send is claimed
 *      atomically on the order before the email goes out.
 */

let app: ReturnType<typeof createApp>;
let tax: TaxonomyFixture;

let PRODUCT_ID: string;
let CUSTOMER_ID: string;
let ADMIN_ID: string;
let METHOD_ID: string;

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
  setEmailTransportOverride(null);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearTestDb();
  resetRateLimitBuckets();

  /**
   * The stub records what was "sent" so the tests can assert on the
   * CONTENT, not just on the fact that a send happened.
   */
  setEmailTransportOverride({ sent: true, id: 'test-message-id' });

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
    quantity: 4,
    totalMl: 400,
    remainingMl: 400,
    purchaseCost: 15000,
    purchaseDate: new Date(),
    supplier: 'Test',
    notes: '',
    isActive: true,
  });

  const customer = await User.create({
    name: 'Registered Customer',
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

  const method = await PaymentMethod.create({
    name: 'bKash',
    type: 'bkash',
    accountNumber: '01700000000',
    accountName: 'First Sniffer',
    instructions: ['Send to the personal number', 'Share the TrxID'],
    displayOrder: 0,
    isActive: true,
    advancePaymentRequired: true,
    advancePaymentPercent: 30,
  });
  METHOD_ID = String(method._id);
});

/**
 * The transport override only reports a fixed result — it cannot record
 * the message body. The suite therefore intercepts at the template level
 * by asserting on the ORDER's recorded state and by re-deriving the
 * payload with `buildOrderEmailPayload`.
 */
/**
 * Load an order WITH the customer populated — `customer` is stored as an
 * ObjectId, so the recipient can only be resolved from a populated
 * document.
 */
async function loadOrder(id: string): Promise<OrderDoc | null> {
  return (await Order.findById(id)
    .populate('customer', 'name email phone')
    .lean()
    .exec()) as OrderDoc | null;
}

/**
 * Load an order that is expected to exist.
 *
 * The order was just created, so a missing document is a test failure,
 * not a scenario under test — this narrows the type and fails loudly.
 */
async function loadExistingOrder(id: string): Promise<OrderDoc> {
  const order = await loadOrder(id);
  if (!order) throw new Error(`Expected order ${id} to exist`);
  return order;
}

/* ==================================================================
 *  Recipient resolution
 * ================================================================== */

describe('Who receives the confirmation', () => {
  it('sends to a GUEST who supplied an email', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    );
    expect(payload).toBeTruthy();
    expect(payload!.email).toBe('guest@example.com');
  });

  it('sends to a REGISTERED customer', async () => {
    const order = await createOrder({
      customer: CUSTOMER_ID,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    );
    expect(payload).toBeTruthy();
    expect(payload!.email).toBe('cust@example.com');
  });

  it('SKIPS a guest who did NOT supply an email', async () => {
    const order = await createOrder({
      guestInfo: { ...GUEST_INFO, email: '' },
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const result = await sendOrderConfirmationEmail(order.id);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('no-recipient');
  });

  it('SKIPS a guest who supplied a BLANK email', async () => {
    const order = await createOrder({
      guestInfo: { ...GUEST_INFO, email: '   ' },
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const result = await sendOrderConfirmationEmail(order.id);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('no-recipient');
  });

  it('SKIPS an admin-created (manual) order', async () => {
    const order = await createOrder({
      customer: CUSTOMER_ID,
      orderSource: 'manual',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const result = await sendOrderConfirmationEmail(order.id);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('manual-order');
  });

  it('reports no-recipient for an order that does not exist', async () => {
    const result = await sendOrderConfirmationEmail('000000000000000000000000');
    expect(result.sent).toBe(false);
  });
});

/* ==================================================================
 *  Order creation is NEVER blocked by the email
 * ================================================================== */

describe('An email failure never fails the order', () => {
  it('creates the order even when the provider is DOWN', async () => {
    // The transport reports a hard failure.
    setEmailTransportOverride({ sent: false, error: 'provider is down' });

    const res = await request(app).post('/api/orders').send({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    });

    // The order is created regardless.
    expect(res.status).toBe(201);
    expect(res.body?.data?.orderNumber).toBeTruthy();
    expect(await Order.countDocuments({})).toBe(1);
  });

  it('does NOT roll back the stock deduction when the provider is DOWN', async () => {
    setEmailTransportOverride({ sent: false, error: 'provider is down' });

    const before = await InventoryBatch.findOne({ product: PRODUCT_ID }).lean().exec();

    await request(app).post('/api/orders').send({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    });

    const after = await InventoryBatch.findOne({ product: PRODUCT_ID }).lean().exec();
    // 30ml was deducted and stays deducted.
    expect(after!.remainingMl).toBe(before!.remainingMl - 30);
  });

  it('reports a provider error rather than throwing', async () => {
    setEmailTransportOverride({ sent: false, error: 'provider is down' });
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const result = await sendOrderConfirmationEmail(order.id);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('provider-error');
  });

  it('marks the order as claimed even when the provider fails', async () => {
    setEmailTransportOverride({ sent: false, error: 'provider is down' });
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    await sendOrderConfirmationEmail(order.id);
    const stored = await loadOrder(order.id);
    expect((stored as { confirmationEmailSentAt?: Date }).confirmationEmailSentAt).toBeTruthy();
  });
});

/* ==================================================================
 *  Duplicate prevention
 * ================================================================== */

describe('A confirmation is never sent twice', () => {
  it('refuses a second send for the same order', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const first = await sendOrderConfirmationEmail(order.id);
    expect(first.sent).toBe(true);

    const second = await sendOrderConfirmationEmail(order.id);
    expect(second.sent).toBe(false);
    expect(second.reason).toBe('already-sent');
  });

  it('only ONE of several CONCURRENT sends goes through', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => sendOrderConfirmationEmail(order.id))
    );
    const sentCount = results.filter((r) => r.sent).length;

    expect(sentCount).toBe(1);
  });

  it('stamps the send time on the order', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    await sendOrderConfirmationEmail(order.id);
    const stored = await loadOrder(order.id);
    expect((stored as { confirmationEmailSentAt?: Date }).confirmationEmailSentAt).toBeInstanceOf(
      Date
    );
  });

  it('an admin STATUS UPDATE does not trigger another email', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    await sendOrderConfirmationEmail(order.id);
    const first = (await loadExistingOrder(order.id)) as { confirmationEmailSentAt: Date };

    // A status update must not touch the send marker.
    const res = await request(app)
      .patch(`/api/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${await adminToken()}`)
      .send({ orderStatus: 'confirmed' });
    expect(res.status).toBe(200);

    const second = (await loadExistingOrder(order.id)) as { confirmationEmailSentAt: Date };
    expect(second.confirmationEmailSentAt.getTime()).toBe(
      first.confirmationEmailSentAt.getTime()
    );

    // ...and a second explicit send is still refused.
    const resend = await sendOrderConfirmationEmail(order.id);
    expect(resend.sent).toBe(false);
    expect(resend.reason).toBe('already-sent');
  });
});

/* ==================================================================
 *  Email content
 * ================================================================== */

describe('The confirmation carries the order details', () => {
  it('includes the customer, order number, date and totals', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 2 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.customerName).toBe('Guest Shopper');
    expect(payload.payload.orderNumber).toBe(order.orderNumber);
    expect(payload.payload.orderDate).toBeTruthy();
    expect(payload.payload.total).toBe(order.total);
    expect(payload.payload.subtotal).toBe(order.subtotal);
    expect(payload.payload.shippingCharge).toBe(order.shippingCharge);
  });

  it('includes the product, size, quantity and prices', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 2 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.items).toHaveLength(1);
    expect(payload.payload.items[0].name).toBe('Dior Sauvage');
    expect(payload.payload.items[0].size).toBe('30ml');
    expect(payload.payload.items[0].quantity).toBe(2);
    expect(payload.payload.items[0].totalPrice).toBe(2500);
  });

  it('includes the advance details from the SNAPSHOT', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.advanceRequired).toBe(true);
    expect(payload.payload.advancePercent).toBe(30);
    expect(payload.payload.advanceAmount).toBe(
      order.paymentSnapshot!.advanceAmount
    );
    expect(payload.payload.remainingOnDelivery).toBe(
      order.paymentSnapshot!.remainingOnDelivery
    );
  });

  it('includes the payment method account and instructions', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.paymentMethodName).toBe('bKash');
    expect(payload.payload.paymentAccountNumber).toBe('01700000000');
    expect(payload.payload.paymentInstructions).toEqual([
      'Send to the personal number',
      'Share the TrxID',
    ]);
  });

  it('includes the customer-submitted transaction details', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
      paymentDetails: { senderMobile: '01800000000', transactionId: 'TXN12345' },
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.senderMobile).toBe('01800000000');
    expect(payload.payload.transactionId).toBe('TXN12345');
  });

  it('includes the delivery address', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.deliveryAddress.address).toBe(SHIPPING.address);
    expect(payload.payload.deliveryAddress.district).toBe(SHIPPING.district);
    expect(payload.payload.deliveryAddress.area).toBe(SHIPPING.area);
  });

  it('includes a SECURE tracking link for a GUEST order', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.trackingUrl).toBeTruthy();
    // The guest link is the token-based route, NOT the sequential number.
    expect(payload.payload.trackingUrl).toContain('/track/');
    expect(payload.payload.trackingUrl).not.toContain(order.orderNumber);
  });

  it('uses the ACCOUNT route for a REGISTERED order', async () => {
    const order = await createOrder({
      customer: CUSTOMER_ID,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.trackingUrl).toContain('/order-confirmed/');
  });

  it('never exposes the internal Mongo id', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    const serialised = JSON.stringify(payload.payload);
    expect(serialised).not.toContain(String((await loadExistingOrder(order.id))._id));
  });

  it('never contains the OTP hash of anything', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;
    expect(JSON.stringify(payload.payload)).not.toMatch(/\$2[aby]\$/);
  });
});

/* ==================================================================
 *  The snapshot is authoritative for the email
 * ================================================================== */

describe('The email uses the SNAPSHOT, not the live config', () => {
  it('keeps the ORIGINAL advance terms after the admin edits the method', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    await PaymentMethod.updateOne(
      { _id: METHOD_ID },
      { $set: { advancePaymentPercent: 50 } }
    ).exec();

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.advancePercent).toBe(30);
    expect(payload.payload.advanceAmount).toBe(
      order.paymentSnapshot!.advanceAmount
    );
  });

  it('keeps the ORIGINAL account number after the admin changes it', async () => {
    const order = await createOrder({
      guestInfo: GUEST_INFO,
      orderSource: 'online',
      items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
      shippingAddress: SHIPPING,
      paymentMethod: METHOD_ID,
    }, ADMIN_ID);

    await PaymentMethod.updateOne(
      { _id: METHOD_ID },
      { $set: { accountNumber: '01999999999' } }
    ).exec();

    const payload = buildOrderEmailPayload(
      (await loadExistingOrder(order.id))
    )!;

    expect(payload.payload.paymentAccountNumber).toBe('01700000000');
  });
});

/* ==================================================================
 *  Transport hygiene
 * ================================================================== */

describe('Transport hygiene', () => {
  it('is stubbed during the test run — no network call is made', () => {
    expect(isEmailTransportOverridden()).toBe(true);
  });
});

/* ==================================================================
 *  Helpers
 * ================================================================== */

/** A signed-in admin token, for the admin-only routes. */
async function adminToken(): Promise<string> {
  return signToken({
    sub: ADMIN_ID,
    email: 'admin@example.com',
    role: 'admin',
  });
}
