import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import mongoose from 'mongoose';
import { createApp } from '../app';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  seedProducts,
  seedInventory,
  type TaxonomyFixture,
} from './harness';
import { Combo } from '../modules/combo/combo.model';
import { Coupon } from '../modules/coupon/coupon.model';
import { Product } from '../modules/product/product.model';

/**
 * End-to-end HTTP tests for the PUBLIC combos, coupons and order-preview
 * endpoints.
 *
 * These three were the storefront's blind spots:
 *
 *   - `/api/combos` is admin-only, so a bundle the admin built was neither
 *     visible nor buyable.
 *   - `/api/coupons/validate` is admin-only, so a customer could not check
 *     a code — and the checkout form had no coupon field at all.
 *   - `/api/orders/calculate` is admin-only, so the checkout page priced
 *     the cart entirely on the client while the order was priced again
 *     server-side at creation. The two could disagree.
 *
 * These tests lock in the public read paths AND the non-mutating nature of
 * the coupon check and the order preview.
 */

let app: Application;
let tax: TaxonomyFixture;
let productId: mongoose.Types.ObjectId;
let otherProductId: mongoose.Types.ObjectId;

interface PublicComboRow {
  id: string;
  name: string;
  slug: string;
  comboPrice: number;
  image: { url: string; fileId: string } | null;
  products: Array<{
    product: string;
    size: string;
    ml: number;
    name: string;
    slug: string;
    image: string;
    inStock: boolean;
  }>;
  inStock: boolean;
}

interface CouponCheck {
  code: string;
  valid: boolean;
  discount: number;
  reason?: string;
}

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
  const ids = await seedProducts(tax, [
    { name: 'Sauvage', brand: tax.brands.Dior, prices: [250] },
    { name: 'Bleu de Chanel', brand: tax.brands.Chanel, prices: [400] },
  ]);
  productId = ids.Sauvage;
  otherProductId = ids['Bleu de Chanel'];

  /* Give both products real stock so the combo is sellable. */
  await seedInventory([
    { product: productId, productName: 'Sauvage', remainingMl: 100 },
    { product: otherProductId, productName: 'Bleu de Chanel', remainingMl: 100 },
  ]);
});

async function makeCombo(overrides: Record<string, unknown> = {}) {
  return Combo.create({
    name: 'Sauvage Duo',
    slug: 'sauvage-duo',
    products: [
      { product: productId, size: '3ml', millilitres: 3 },
      { product: otherProductId, size: '5ml', millilitres: 5 },
    ],
    comboPrice: 500,
    isActive: true,
    ...overrides,
  });
}

async function makeCoupon(overrides: Record<string, unknown> = {}) {
  return Coupon.create({
    code: 'SAVE50',
    type: 'fixed',
    value: 50,
    minPurchase: 0,
    usageLimit: 10,
    usedCount: 0,
    isActive: true,
    expiresAt: new Date(Date.now() + 86_400_000 * 30),
    ...overrides,
  });
}

describe('GET /api/public/combos — the storefront bundle list', () => {
  it('returns active combos as a FLAT ARRAY with resolved components', async () => {
    await makeCombo();

    const res = await request(app).get('/api/public/combos').expect(200);

    expect(res.body.success).toBe(true);
    const data = res.body.data as PublicComboRow[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Sauvage Duo');
    expect(data[0].comboPrice).toBe(500);
    expect(data[0].products).toHaveLength(2);
    /* The component's product details are resolved so the card can show
     * what is inside without a second request. */
    expect(data[0].products[0].name).toBe('Sauvage');
    expect(data[0].products[0].slug).toBeTruthy();
    expect(data[0].products[0].image).toBeTruthy();
    expect(data[0].products[0].size).toBe('3ml');
  });

  it('HIDES inactive combos', async () => {
    await makeCombo({ isActive: false });

    const res = await request(app).get('/api/public/combos').expect(200);
    expect(res.body.data as PublicComboRow[]).toHaveLength(0);
  });

  it('marks a combo out of stock when a component product is deactivated', async () => {
    await makeCombo();
    await Product.findByIdAndUpdate(otherProductId, { $set: { isActive: false } });

    const res = await request(app).get('/api/public/combos').expect(200);
    const data = res.body.data as PublicComboRow[];
    expect(data).toHaveLength(1);
    expect(data[0].inStock).toBe(false);
  });

  it('marks a combo out of stock when a component has no sellable stock', async () => {
    await makeCombo();
    /* The safety buffer is a flat product field — it is subtracted from the
     * batch total to give the sellable ml. A buffer above the whole batch
     * leaves nothing sellable, so the bundle must be unavailable. */
    await Product.findByIdAndUpdate(otherProductId, {
      $set: { safetyBufferMl: 1000 },
    });

    const res = await request(app).get('/api/public/combos').expect(200);
    const data = res.body.data as PublicComboRow[];
    expect(data[0].inStock).toBe(false);
  });

  it('returns an empty array — not an error — when there are no combos', async () => {
    const res = await request(app).get('/api/public/combos').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('does NOT require authentication', async () => {
    const res = await request(app).get('/api/public/combos').expect(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/public/coupons/validate — the checkout coupon check', () => {
  it('accepts a valid code and reports the discount', async () => {
    await makeCoupon();

    const res = await request(app)
      .get('/api/public/coupons/validate?code=SAVE50&subtotal=1000')
      .expect(200);

    const data = res.body.data as CouponCheck;
    expect(data.valid).toBe(true);
    expect(data.discount).toBe(50);
    expect(data.code).toBe('SAVE50');
  });

  it('rejects an unknown code', async () => {
    const res = await request(app)
      .get('/api/public/coupons/validate?code=NOPE&subtotal=1000')
      .expect(200);

    const data = res.body.data as CouponCheck;
    expect(data.valid).toBe(false);
    expect(data.discount).toBe(0);
    expect(data.reason).toBeTruthy();
  });

  it('rejects an inactive code', async () => {
    await makeCoupon({ isActive: false });

    const res = await request(app)
      .get('/api/public/coupons/validate?code=SAVE50&subtotal=1000')
      .expect(200);

    expect((res.body.data as CouponCheck).valid).toBe(false);
  });

  it('rejects an expired code', async () => {
    await makeCoupon({ expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app)
      .get('/api/public/coupons/validate?code=SAVE50&subtotal=1000')
      .expect(200);

    expect((res.body.data as CouponCheck).valid).toBe(false);
  });

  it('rejects a code whose usage limit is exhausted', async () => {
    await makeCoupon({ usageLimit: 5, usedCount: 5 });

    const res = await request(app)
      .get('/api/public/coupons/validate?code=SAVE50&subtotal=1000')
      .expect(200);

    expect((res.body.data as CouponCheck).valid).toBe(false);
  });

  it('rejects a code below its minimum purchase', async () => {
    await makeCoupon({ minPurchase: 500 });

    const res = await request(app)
      .get('/api/public/coupons/validate?code=SAVE50&subtotal=100')
      .expect(200);

    const data = res.body.data as CouponCheck;
    expect(data.valid).toBe(false);
    expect(data.reason).toContain('500');
  });

  it('computes a percentage discount against the subtotal', async () => {
    await makeCoupon({ code: 'TENOFF', type: 'percentage', value: 10 });

    const res = await request(app)
      .get('/api/public/coupons/validate?code=TENOFF&subtotal=1000')
      .expect(200);

    expect((res.body.data as CouponCheck).discount).toBe(100);
  });

  it('is NON-MUTATING — probing a code never burns its usage count', async () => {
    const coupon = await makeCoupon({ usageLimit: 1 });

    await request(app)
      .get('/api/public/coupons/validate?code=SAVE50&subtotal=1000')
      .expect(200);
    await request(app)
      .get('/api/public/coupons/validate?code=SAVE50&subtotal=1000')
      .expect(200);

    const after = await Coupon.findById(coupon._id).lean().exec();
    expect(after?.usedCount).toBe(0);
  });

  it('requires a code', async () => {
    await request(app).get('/api/public/coupons/validate').expect(400);
  });
});

describe('POST /api/public/order-preview/calculate — the storefront pricing', () => {
  it('prices a cart server-side and returns the authoritative total', async () => {
    const res = await request(app)
      .post('/api/public/order-preview/calculate')
      .send({
        items: [{ product: String(productId), size: '3ml', quantity: 2 }],
        shippingZone: 'inside-ctg',
      })
      .expect(200);

    const data = res.body.data;
    expect(data.subtotal).toBe(500);
    expect(data.discount).toBe(0);
    expect(data.total).toBe(data.subtotal + data.shippingCharge);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].inStock).toBe(true);
  });

  it('includes a combo line in the total', async () => {
    const combo = await makeCombo();

    const res = await request(app)
      .post('/api/public/order-preview/calculate')
      .send({
        items: [{ product: String(productId), size: '3ml', quantity: 1 }],
        combos: [{ combo: String(combo._id), quantity: 1 }],
        shippingZone: 'inside-ctg',
      })
      .expect(200);

    const data = res.body.data;
    /* 250 (the bottle) + 500 (the bundle). */
    expect(data.subtotal).toBe(750);
    expect(data.combos).toHaveLength(1);
    expect(data.combos[0].inStock).toBe(true);
  });

  it('applies the coupon to the total', async () => {
    await makeCoupon({ value: 100 });

    const res = await request(app)
      .post('/api/public/order-preview/calculate')
      .send({
        items: [{ product: String(productId), size: '3ml', quantity: 2 }],
        shippingZone: 'inside-ctg',
        couponCode: 'SAVE50',
      })
      .expect(200);

    const data = res.body.data;
    expect(data.discount).toBe(100);
    expect(data.total).toBe(data.subtotal - data.discount + data.shippingCharge);
  });

  it('is NON-MUTATING — a preview deducts no stock', async () => {
    await request(app)
      .post('/api/public/order-preview/calculate')
      .send({
        items: [{ product: String(productId), size: '3ml', quantity: 2 }],
        shippingZone: 'inside-ctg',
      })
      .expect(200);

    const { getProductStockForProducts } = await import(
      '../modules/inventory/inventoryBatch.service'
    );
    const stock = await getProductStockForProducts([String(productId)]);
    /* The seed put 100ml in; a preview must not have touched it. */
    expect(stock.get(String(productId))?.sellableMl).toBe(100);
  });

  it('does NOT require authentication — a guest prices their own cart', async () => {
    await request(app)
      .post('/api/public/order-preview/calculate')
      .send({
        items: [{ product: String(productId), size: '3ml', quantity: 1 }],
        shippingZone: 'inside-ctg',
      })
      .expect(200);
  });

  it('rejects a body with no lines', async () => {
    await request(app)
      .post('/api/public/order-preview/calculate')
      .send({ shippingZone: 'inside-ctg' })
      .expect(400);
  });
});
