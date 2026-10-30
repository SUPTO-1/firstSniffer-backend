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
  seedInventory,
  type TaxonomyFixture,
} from './harness';
import { PUBLIC_FACETS } from '../modules/public/publicProductFilter';

/**
 * End-to-end HTTP tests for the storefront listing.
 *
 * These cover the parts of the master prompt that the filter-shape unit tests
 * can't: URL param parsing, pagination maths, sort ordering, the facet-counts
 * aggregation, and the empty/error states a customer actually sees.
 */

let app: Application;
let tax: TaxonomyFixture;

interface ListingBody {
  success: boolean;
  message: string;
  data: {
    results: Array<{ name: string; slug: string; priceRange: { min: number | null; max: number | null } }>;
    page: number;
    limit: number;
    total: number;
    totalPages: number;
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
  await seedProducts(tax, [
    { name: 'Sauvage', brand: tax.brands.Dior, genres: [tax.genres.Fresh], seasons: [tax.seasons.Summer], prices: [1200, 4000] },
    { name: "J'adore", brand: tax.brands.Dior, genres: [tax.genres.Floral], seasons: [tax.seasons.Spring], prices: [1800, 5200] },
    { name: 'Bleu de Chanel', brand: tax.brands.Chanel, genres: [tax.genres.Fresh], seasons: [tax.seasons.Winter], prices: [1500, 4800] },
    { name: 'Coco Chanel', brand: tax.brands.Chanel, genres: [tax.genres.Floral], seasons: [tax.seasons.Autumn], prices: [2000, 6000] },
    { name: 'Oud Wood', brand: tax.brands.Lattafa, genres: [tax.genres.Woody], seasons: [tax.seasons.Autumn], prices: [900, 2600] },
    { name: 'Zara Wood', brand: tax.brands.Zara, genres: [tax.genres.Woody], seasons: [tax.seasons.Autumn], prices: [500, 1400] },
  ]);
});

const get = (url: string) => request(app).get(url);

describe('Test case J — sorting and pagination on the filtered set', () => {
  it('sorts by name ascending and descending', async () => {
    const asc = await get('/api/public/products?sort=name').expect(200);
    const names = (asc.body as ListingBody).data.results.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    const desc = await get('/api/public/products?sort=-name').expect(200);
    const descNames = (desc.body as ListingBody).data.results.map((r) => r.name);
    expect(descNames).toEqual([...names].reverse());
  });

  it('sort applies to the FILTERED set, not the whole catalogue', async () => {
    const res = await get(
      `/api/public/products?brands=${tax.brands.Dior}&sort=name`
    ).expect(200);
    const names = (res.body as ListingBody).data.results.map((r) => r.name);
    expect(names).toEqual(["J'adore", 'Sauvage']);
    expect((res.body as ListingBody).data.total).toBe(2);
  });

  it('paginates the final filtered set with correct totalPages', async () => {
    const page1 = await get(
      `/api/public/products?genres=${tax.genres.Fresh}&limit=1&page=1`
    ).expect(200);
    const b1 = page1.body as ListingBody;
    expect(b1.data.results).toHaveLength(1);
    expect(b1.data.total).toBe(2);
    expect(b1.data.totalPages).toBe(2);
    expect(b1.data.page).toBe(1);

    const page2 = await get(
      `/api/public/products?genres=${tax.genres.Fresh}&limit=1&page=2`
    ).expect(200);
    const b2 = page2.body as ListingBody;
    expect(b2.data.page).toBe(2);
    expect(b2.data.results[0].name).not.toBe(b1.data.results[0].name);
  });

  it('an empty result set reports totalPages 0 rather than breaking', async () => {
    const res = await get('/api/public/products?search=zzzznotathing').expect(200);
    const b = res.body as ListingBody;
    expect(b.success).toBe(true);
    expect(b.data.results).toEqual([]);
    expect(b.data.total).toBe(0);
    expect(b.data.totalPages).toBe(0);
  });

  it('clamps limit and ignores a non-numeric page', async () => {
    const res = await get('/api/public/products?limit=9999&page=abc').expect(200);
    const b = res.body as ListingBody;
    expect(b.data.limit).toBeLessThanOrEqual(60);
    expect(b.data.page).toBe(1);
  });
});

describe('Response shape', () => {
  it('every row carries a derived priceRange', async () => {
    const res = await get('/api/public/products').expect(200);
    const b = res.body as ListingBody;
    expect(b.data.results).toHaveLength(6);
    const sauvage = b.data.results.find((r) => r.name === 'Sauvage');
    expect(sauvage?.priceRange).toEqual({ min: 1200, max: 4000 });
  });

  it('unknown sort / flag values are ignored instead of 500ing', async () => {
    await get('/api/public/products?sort=%3Bdrop%20table&flag=notAFlag').expect(200);
  });

  it('garbage facet ids degrade to "no filter", never an error', async () => {
    const res = await get(
      '/api/public/products?brands=abc,def&genres=%%%&notes.top=zzz'
    ).expect(200);
    expect((res.body as ListingBody).data.total).toBe(6);
  });
});

describe('Test case K — empty and error states', () => {
  it('returns a clean 404 (not 403, not a stack trace) for a missing product', async () => {
    const res = await get('/api/public/products/definitely-not-a-real-slug').expect(404);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.errors).toBeDefined();
    // The message must not leak mongo internals.
    expect(JSON.stringify(res.body)).not.toMatch(/Mongo|ObjectId|at Object\./);
  });

  it('a search that matches nothing is a 200 with zero results', async () => {
    const res = await get('/api/public/products?search=nothingmatchesthis').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results).toEqual([]);
  });
});

describe('Availability filter end-to-end', () => {
  it('?inStock=true returns only products with sellable stock', async () => {
    const ids = await seedProducts(tax, [
      { name: 'In Stock A', brand: tax.brands.Zara, prices: [100] },
      { name: 'Out Of Stock', brand: tax.brands.Zara, prices: [100] },
    ]);
    await seedInventory([
      { product: ids['In Stock A'], productName: 'In Stock A', remainingMl: 500 },
    ]);

    const res = await get(
      `/api/public/products?inStock=true&brands=${tax.brands.Zara}`
    ).expect(200);
    const names = (res.body as ListingBody).data.results.map((r) => r.name);
    // Zara Wood (also brand Zara) has NO inventory row, so it's excluded —
    // that's the whole point of the availability filter.
    expect(names).toEqual(['In Stock A']);
  });

  it('?inStock=false leaves the availability filter off', async () => {
    const res = await get('/api/public/products?inStock=false').expect(200);
    expect((res.body as ListingBody).data.total).toBe(6);
  });
});

describe('Facet counts endpoint', () => {
  it('returns per-facet counts and a total', async () => {
    const res = await get('/api/public/facet-counts').expect(200);
    expect(res.body.success).toBe(true);
    const { counts, total } = res.body.data as {
      counts: Record<string, Array<{ id: string; count: number }>>;
      total: number;
    };
    expect(total).toBe(6);
    for (const key of Object.keys(PUBLIC_FACETS)) {
      expect(Array.isArray(counts[key])).toBe(true);
    }
    // Dior has 2 products.
    const dior = counts.brands.find((b) => b.id === String(tax.brands.Dior));
    expect(dior?.count).toBe(2);
  });

  it('respects the filters passed in', async () => {
    const res = await get(
      `/api/public/facet-counts?brands=${tax.brands.Dior}`
    ).expect(200);
    expect(res.body.data.total).toBe(2);
  });

  it('an unmatched filter set yields total 0 without erroring', async () => {
    const res = await get('/api/public/facet-counts?search=zzzz').expect(200);
    expect(res.body.data.total).toBe(0);
  });
});

describe('Test case H — navbar brand navigation resolves to real routes', () => {
  it('GET /api/public/brands returns active brands for the mega-menu', async () => {
    const res = await get('/api/public/brands?all=true').expect(200);
    const brands = res.body.data as Array<{ id: string; slug: string; name: string }>;
    expect(brands.length).toBeGreaterThan(0);
    for (const b of brands) {
      expect(b.slug).toBeTruthy();
      expect(b.id).toBeTruthy();
    }
    // Every brand has a slug the storefront can link to.
    expect(brands.map((b) => b.slug)).toContain('dior');
  });

  it('GET /api/public/brands/:slug resolves a single brand', async () => {
    const res = await get('/api/public/brands/dior').expect(200);
    expect(res.body.data.name).toBe('Dior');
    expect(res.body.data.slug).toBe('dior');
  });

  it('an unknown brand 404s cleanly', async () => {
    const res = await get('/api/public/brands/nope-not-real').expect(404);
    expect(res.body.success).toBe(false);
  });
});

describe('Catalog endpoints used by the filter sidebar', () => {
  const endpoints = [
    '/api/public/genres',
    '/api/public/notes',
    '/api/public/seasons',
    '/api/public/occasions',
    '/api/public/weathers',
    '/api/public/times',
    '/api/public/atomizers',
  ];
  for (const url of endpoints) {
    it(`GET ${url} responds 200`, async () => {
      const res = await get(url).expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  }
});

describe('Search relevance through HTTP', () => {
  it('case-insensitive and whitespace-tolerant', async () => {
    for (const q of ['sauvage', 'SAUVAGE', '  Sauvage  ']) {
      const res = await get(`/api/public/products?search=${encodeURIComponent(q)}`).expect(200);
      const names = (res.body as ListingBody).data.results.map((r) => r.name);
      expect(names).toContain('Sauvage');
    }
  });

  it('matches by brand name', async () => {
    const res = await get('/api/public/products?search=chanel').expect(200);
    const names = (res.body as ListingBody).data.results.map((r) => r.name);
    // Default sort is newest-first; both Chanel products are seeded in the
    // same tick, so the tie-break is _id desc — assert on the SET, not order.
    expect(names.sort()).toEqual(['Bleu de Chanel', 'Coco Chanel']);
  });

  it('requires all tokens across a multi-word query', async () => {
    const res = await get(
      '/api/public/products?search=' + encodeURIComponent('oud wood')
    ).expect(200);
    const names = (res.body as ListingBody).data.results.map((r) => r.name);
    expect(names).toEqual(['Oud Wood']);
  });
});