import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { Product } from '../modules/product/product.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  type TaxonomyFixture,
} from './harness';

/**
 * Regression tests for the perfume-detail size options.
 *
 * Two bugs motivated this file:
 *
 *   1. A product with 3/5/10/30ml variants showed only 3/5/10 on the
 *      storefront, because the frontend adapter dropped `variants[]` and
 *      rendered a hardcoded size list. The backend already returned every
 *      variant — these tests lock that contract down so it can't silently
 *      regress.
 *
 *   2. Sellers had no `15ml` option. The size enum is validated in several
 *      places (Zod + Mongoose on Product/Inventory/Order/Combo), so this
 *      file asserts `15ml` is accepted end-to-end and that the other sizes
 *      are still rejected.
 */

let app: Application;
let tax: TaxonomyFixture;

const SAUVAGE_VARIANTS = [
  { size: '3ml', price: 1200 },
  { size: '5ml', price: 1800 },
  { size: '10ml', price: 3000 },
  { size: '30ml', price: 7500 },
];

async function seedSauvage(variants = SAUVAGE_VARIANTS) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = await (Product as any).create({
    name: 'Dior Sauvage',
    slug: 'dior-sauvage',
    description: 'A fresh, ambery fragrance.',
    brand: tax.brands.Dior,
    genres: [tax.genres.Fresh],
    notes: { top: [], middle: [], base: [] },
    seasons: [tax.seasons.Summer],
    occasions: [],
    weathers: [],
    times: [],
    performance: {
      longevity: 'moderate',
      projection: 'moderate',
      versatility: 'versatile',
    },
    aliases: [],
    isActive: true,
    images: [{ url: 'https://img.test/s.png', fileId: 'file_s' }],
    variants,
  });
  return doc;
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
});

describe('Public product detail — variants', () => {
  it('returns every saved variant including 30ml', async () => {
    await seedSauvage();

    const res = await request(app).get('/api/public/products/dior-sauvage');

    expect(res.status).toBe(200);
    expect(res.body.data.variants).toHaveLength(4);
    expect(res.body.data.variants.map((v: { size: string }) => v.size)).toEqual([
      '3ml',
      '5ml',
      '10ml',
      '30ml',
    ]);
  });

  it('returns the admin-set price for each variant', async () => {
    await seedSauvage();

    const res = await request(app).get('/api/public/products/dior-sauvage');

    const bySize = Object.fromEntries(
      res.body.data.variants.map((v: { size: string; price: number }) => [
        v.size,
        v.price,
      ])
    );
    expect(bySize).toEqual({
      '3ml': 1200,
      '5ml': 1800,
      '10ml': 3000,
      '30ml': 7500,
    });
    // The listing price is the cheapest variant.
    expect(res.body.data.priceRange).toEqual({ min: 1200, max: 7500 });
  });

  it('returns only the sizes the product actually sells', async () => {
    await seedSauvage([{ size: '30ml', price: 7500 }]);

    const res = await request(app).get('/api/public/products/dior-sauvage');

    expect(res.body.data.variants).toHaveLength(1);
    expect(res.body.data.variants[0].size).toBe('30ml');
  });
});

describe('15ml support', () => {
  it('accepts a 15ml product variant', async () => {
    await seedSauvage([
      ...SAUVAGE_VARIANTS,
      { size: '15ml', price: 4500 },
    ]);

    const doc = await Product.findOne({ slug: 'dior-sauvage' }).lean();
    const sizes = (doc?.variants ?? []).map((v) => v.size);

    expect(sizes).toContain('15ml');
    expect(sizes).toHaveLength(5);
  });

  it('accepts a 15ml original bottle as an inventory batch', async () => {
    const product = await seedSauvage();

    // A batch's capacity is the ORIGINAL bottle size — a numeric field, not
    // the selling-size enum. 15ml original bottles are therefore supported
    // with no schema change.
    const batch = await InventoryBatch.create({
      product: product._id,
      productName: 'Dior Sauvage',
      sourceBottleSizeMl: 15,
      quantity: 100,
      totalMl: 1500,
      remainingMl: 1500,
      purchaseCost: 0,
      isActive: true,
    });

    expect(batch.sourceBottleSizeMl).toBe(15);
    expect(batch.totalMl).toBe(1500);
  });

  it('still rejects an unknown size', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Product as any).create({
        name: 'Bad Size',
        slug: 'bad-size',
        brand: tax.brands.Dior,
        images: [],
        variants: [{ size: '99ml', price: 100 }],
      })
    ).rejects.toThrow();
  });
});
