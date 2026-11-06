import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { Product } from '../modules/product/product.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { User } from '../modules/user/user.model';
import { setEmailTransportOverride } from '../modules/email/email.service';
import { issueInitialOtp } from '../modules/auth/otpChallenge.service';
import { resetRateLimitBuckets } from '../middleware/rateLimiter';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  type TaxonomyFixture,
} from './harness';

/**
 * END-TO-END: a registered customer places an order.
 *
 * This reproduces the exact storefront journey:
 *
 *   1. POST /api/auth/register        → pending account, OTP emailed
 *   2. POST /api/auth/verify-otp       → account activated, JWT + cookie
 *   3. POST /api/orders                → the order, authenticated by
 *                                        the cookie issued in step 2
 *
 * The bug this guards against: step 3 answered "Authentication required"
 * because the auth cookie never reached the backend, so the backend saw
 * an anonymous caller trying to order against a named customer.
 */

let app: ReturnType<typeof createApp>;
let tax: TaxonomyFixture;
let PRODUCT_ID: string;

const EMAIL = 'kjabed369@gmail.com';
const PASSWORD = 'Passw0rd!23';
const PHONE = '01712345678';

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
  });
});

/**
 * Issue the OTP for a freshly registered account.
 *
 * The stored value is a bcrypt hash, so the code cannot be read back
 * from the challenge document. `issueInitialOtp` returns the plaintext
 * code it just generated, which is what the test needs.
 */
async function issueOtp(): Promise<string> {
  const { otp } = await issueInitialOtp(EMAIL);
  return otp;
}

describe('A registered customer can place an order', () => {
  it('accepts the order once the OTP cookie is presented', async () => {
    /* --- 1. register --- */
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Tahsin Rahman', email: EMAIL, password: PASSWORD, phone: PHONE });
    expect(reg.status).toBe(201);
    expect(reg.body?.data?.verificationRequired).toBe(true);

    /* --- 2. verify the OTP --- */
    const otp = await issueOtp();
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp });

    if (verify.status !== 200) {
      throw new Error(
        `verify-otp failed: status=${verify.status} body=${JSON.stringify(verify.body)} otp=${otp}`
      );
    }
    expect(verify.status).toBe(200);
    expect(verify.body?.data?.id).toBeTruthy();

    /**
     * The cookie MUST be present, and it must be usable by a subsequent
     * request. `SameSite=Lax` is fine for a same-site deployment, but a
     * cross-site API (different hostname) needs `SameSite=None; Secure`
     * — otherwise the browser silently drops the cookie and the next
     * request is anonymous.
     */
    const setCookie = verify.headers['set-cookie'] ?? [];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const authCookie = cookies.find((c) => /fs_token/i.test(c));
    expect(authCookie, 'verify-otp must set the auth cookie').toBeTruthy();

    /* --- 3. place the order with that cookie --- */
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Cookie', [authCookie as string])
      .send({
        customer: verify.body?.data?.id,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: {
          label: 'Home',
          district: 'Chattogram',
          area: 'Gulshan',
          address: 'House 12, Road 7',
        },
      });

    expect(
      orderRes.status,
      `order creation failed: ${JSON.stringify(orderRes.body)}`
    ).toBe(201);
    expect(orderRes.body?.data?.orderNumber).toBeTruthy();
    expect(orderRes.body?.data?.isGuestOrder).toBe(false);
  });

  it('rejects the SAME order when the cookie is missing (the reported bug)', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Tahsin Rahman', email: EMAIL, password: PASSWORD, phone: PHONE });
    const otp = await issueOtp();
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp });
    expect(verify.status).toBe(200);

    /* Same body, NO cookie. The backend must treat this as an anonymous
     * caller naming a customer it cannot prove — a 401, never a silent
     * order against someone else's account. */
    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        customer: verify.body?.data?.id,
        orderSource: 'online',
        items: [{ product: PRODUCT_ID, size: '30ml', quantity: 1 }],
        shippingAddress: {
          label: 'Home',
          district: 'Chattogram',
          area: 'Gulshan',
          address: 'House 12, Road 7',
        },
      });

    expect(orderRes.status).toBe(401);
    expect(orderRes.body?.message).toMatch(/Authentication required/i);
  });

  it('lets the activated customer sign in afterwards', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Tahsin Rahman', email: EMAIL, password: PASSWORD, phone: PHONE });
    const otp = await issueOtp();
    await request(app).post('/api/auth/verify-otp').send({ email: EMAIL, otp });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body?.data?.email).toBe(EMAIL);

    const user = await User.findOne({ email: EMAIL.toLowerCase() }).lean().exec();
    expect(user?.isActive).toBe(true);
  });
});
