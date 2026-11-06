import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  seedProducts,
  type TaxonomyFixture,
} from './harness';
import { Review } from '../modules/review/review.model';
import { Product } from '../modules/product/product.model';
import { User } from '../modules/user/user.model';
import mongoose from 'mongoose';

/**
 * End-to-end HTTP tests for the PUBLIC reviews endpoint.
 *
 * The storefront's review section used to be permanently empty: the product
 * adapter hardcoded `reviews: []` and the only reviews endpoint was
 * admin-only. These tests lock in that:
 *
 *   - approved + active reviews ARE served publicly
 *   - pending / rejected / inactive reviews are NOT
 *   - the reviewer's identity is never leaked (no id, no email)
 *   - a review whose product is gone is dropped, not shown as an orphan
 */

let app: Application;
let tax: TaxonomyFixture;
let productId: mongoose.Types.ObjectId;
let otherProductId: mongoose.Types.ObjectId;
let customerId: mongoose.Types.ObjectId;

interface PublicReviewRow {
  id: string;
  rating: number;
  title: string;
  comment: string;
  images: { url: string }[];
  author: string;
  verified: boolean;
  date: string;
  product: {
    id: string;
    name: string;
    slug: string;
    image: string;
    brandName: string;
    averageRating: number;
  };
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
    { name: 'Sauvage', brand: tax.brands.Dior, prices: [1200] },
    { name: 'Bleu de Chanel', brand: tax.brands.Chanel, prices: [1500] },
  ]);
  productId = ids.Sauvage;
  otherProductId = ids['Bleu de Chanel'];

  const customer = await User.create({
    name: 'Real Customer Name',
    email: `customer-${Date.now()}@example.com`,
    mobile: '01700000000',
    password: 'hashed-password',
  });
  customerId = customer._id;
});

async function makeReview(overrides: Record<string, unknown> = {}) {
  /**
   * A fresh customer per review. The schema enforces ONE review per
   * (product, customer), so reusing the same customer for several reviews on
   * the same product would be a duplicate-key error — not a moderation
   * scenario.
   */
  const customer = await User.create({
    name: `Customer ${Math.random().toString(36).slice(2, 10)}`,
    email: `customer-${Math.random().toString(36).slice(2, 10)}@example.com`,
    mobile: `01${Math.floor(Math.random() * 900000000 + 100000000)}`,
    password: 'hashed-password',
  });

  return Review.create({
    product: productId,
    customer: customer._id,
    rating: 5,
    title: 'Superb scent',
    comment: 'Lasts all day and the projection is beautiful.',
    images: [{ url: 'https://img.test/review.jpg', fileId: 'file_r' }],
    status: 'approved',
    isActive: true,
    ...overrides,
  });
}

describe('GET /api/public/reviews — the storefront review feed', () => {
  it('returns approved active reviews with their product details', async () => {
    await makeReview();

    const res = await request(app).get('/api/public/reviews').expect(200);

    expect(res.body.success).toBe(true);
    const data = res.body.data as PublicReviewRow[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Superb scent');
    expect(data[0].comment).toContain('Lasts all day');
    expect(data[0].rating).toBe(5);
    expect(data[0].product.name).toBe('Sauvage');
    expect(data[0].product.slug).toBeTruthy();
    expect(data[0].product.image).toBeTruthy();
    expect(data[0].product.brandName).toBe('Dior');
  });

  it('HIDES pending and rejected reviews — moderation still applies', async () => {
    await makeReview({ title: 'Approved one' });
    await makeReview({
      title: 'Pending one',
      status: 'pending',
      product: otherProductId,
    });
    await makeReview({
      title: 'Rejected one',
      status: 'rejected',
      product: otherProductId,
    });

    const res = await request(app).get('/api/public/reviews').expect(200);
    const data = res.body.data as PublicReviewRow[];
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Approved one');
  });

  it('HIDES inactive reviews', async () => {
    await makeReview({ title: 'Hidden', isActive: false });

    const res = await request(app).get('/api/public/reviews').expect(200);
    expect(res.body.data as PublicReviewRow[]).toHaveLength(0);
  });

  it('NEVER leaks the reviewer identity — no id, no email, no name', async () => {
    await makeReview();

    const res = await request(app).get('/api/public/reviews').expect(200);
    const raw = JSON.stringify(res.body.data);

    expect(raw).not.toContain('customer-');
    expect(raw).not.toContain('@example.com');
    expect(raw).not.toContain(String(customerId));
    expect(raw).not.toContain('Real Customer Name');

    const row = (res.body.data as PublicReviewRow[])[0];
    expect(row.author).toBe('Verified Customer');
    expect(row.verified).toBe(true);
  });

  it('drops a review whose product has been deleted', async () => {
    await makeReview({ title: 'Orphan' });
    await Product.findByIdAndUpdate(productId, {
      $set: { deletedAt: new Date() },
    });

    const res = await request(app).get('/api/public/reviews').expect(200);
    expect(res.body.data as PublicReviewRow[]).toHaveLength(0);
  });

  it('drops a review whose product was deactivated', async () => {
    await makeReview({ title: 'Inactive product' });
    await Product.findByIdAndUpdate(productId, { $set: { isActive: false } });

    const res = await request(app).get('/api/public/reviews').expect(200);
    expect(res.body.data as PublicReviewRow[]).toHaveLength(0);
  });

  it('can be scoped to a single product', async () => {
    await makeReview({ title: 'For Sauvage' });
    await makeReview({
      title: 'For Bleu',
      product: otherProductId,
    });

    const res = await request(app)
      .get(`/api/public/reviews?product=${otherProductId}`)
      .expect(200);

    const data = res.body.data as PublicReviewRow[];
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('For Bleu');
  });

  it('returns an empty array — not an error — when there are no reviews', async () => {
    const res = await request(app).get('/api/public/reviews').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('does NOT require authentication', async () => {
    // No Authorization header — this is the storefront path.
    const res = await request(app).get('/api/public/reviews').expect(200);
    expect(res.body.success).toBe(true);
  });
});
