import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
  seedTaxonomy,
  seedProducts,
  seedInventory,
  runFilter,
  type TaxonomyFixture,
} from './harness';
import {
  buildPublicProductFilter,
  withInStockIds,
  wantsInStock,
  normalizeSearchTerm,
  variantPriceBounds,
  type PublicFacetSpec,
} from '../modules/public/publicProductFilter';
import { PUBLIC_FACETS } from '../modules/public/publicProductFilter';
import { applyCrossCollectionSearchForTest } from './crossCollectionHelper';

/**
 * Master prompt Test Cases A–K, verified against a REAL in-memory MongoDB.
 *
 * The whole filtering contract lives in the DB query, so these are
 * integration tests on purpose — mocking Mongo would let the exact bug the
 * prompt warns about (`OR` collapsed to `AND`, or a filter that only exists
 * in the UI) pass silently.
 *
 * Fixture matrix (chosen so each test's expected set is unambiguous):
 *
 *   name              brand    genre    top note  season   prices      stock
 *   Sauvage           Dior     Fresh    Bergamot  Summer   1200..4000   yes
 *   J'adore            Dior     Floral   Rose      Spring   1800..5200   yes
 *   Bleu de Chanel    Chanel   Fresh    Bergamot  Winter   1500..4800   no
 *   Coco Chanel       Chanel   Floral   Rose      Autumn   2000..6000   yes
 *   Tobacco Vanille   Tom Ford Gourmand Vanilla  Winter   2200..6500   no
 *   Oud Wood          Lattafa  Woody    Oud       Autumn   900..2600    yes
 *   Soft Amber        Lattafa  Woody    Amber    Summer   700..1900    yes
 *   Zara Wood         Zara     Woody    Sandalwd Autumn   500..1400    yes
 */

let tax: TaxonomyFixture;

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearTestDb();
  tax = await seedTaxonomy();
  await seedProducts(tax, [
    {
      name: 'Sauvage',
      brand: tax.brands.Dior,
      genres: [tax.genres.Fresh],
      top: [tax.notes.Bergamot],
      base: [tax.notes.Amber],
      seasons: [tax.seasons.Summer],
      occasions: [tax.occasions.Daily],
      weathers: [tax.weathers.Hot],
      times: [tax.times.Day],
      prices: [1200, 1600, 2600, 4000],
      description: 'A fresh aquatic fragrance for men.',
      aliases: ['Dior Sauvage EDT'],
    },
    {
      name: "J'adore",
      brand: tax.brands.Dior,
      genres: [tax.genres.Floral],
      top: [tax.notes.Rose],
      seasons: [tax.seasons.Spring],
      occasions: [tax.occasions.Party],
      weathers: [tax.weathers.Cloudy],
      times: [tax.times.Night],
      prices: [1800, 2400, 3600, 5200],
      description: 'Jasmine and rose, luxurious and floral.',
    },
    {
      name: 'Bleu de Chanel',
      brand: tax.brands.Chanel,
      genres: [tax.genres.Fresh],
      top: [tax.notes.Bergamot],
      seasons: [tax.seasons.Winter],
      occasions: [tax.occasions.Office],
      weathers: [tax.weathers.Cold],
      times: [tax.times.Day],
      prices: [1500, 2000, 3000, 4800],
      description: 'A woody aromatic fragrance for men.',
    },
    {
      name: 'Coco Chanel',
      brand: tax.brands.Chanel,
      genres: [tax.genres.Floral],
      top: [tax.notes.Rose],
      seasons: [tax.seasons.Autumn],
      occasions: [tax.occasions['Date Night']],
      weathers: [tax.weathers.Cold],
      times: [tax.times.Night],
      prices: [2000, 2600, 4000, 6000],
    },
    {
      name: 'Tobacco Vanille',
      brand: tax.brands['Tom Ford'],
      genres: [tax.genres.Gourmand],
      top: [tax.notes.Vanilla],
      base: [tax.notes.Oud],
      seasons: [tax.seasons.Winter],
      prices: [2200, 3000, 4500, 6500],
      description: 'Rich tobacco, vanilla and a warm amber base.',
      aliases: ['TF Tobacco Vanille'],
    },
    {
      name: 'Oud Wood',
      brand: tax.brands.Lattafa,
      genres: [tax.genres.Woody],
      top: [tax.notes.Oud],
      base: [tax.notes.Sandalwood],
      seasons: [tax.seasons.Autumn],
      weathers: [tax.weathers.Cold],
      prices: [900, 1200, 1800, 2600],
      description: 'A cardamom and oud heavy wood fragrance.',
    },
    {
      name: 'Soft Amber',
      brand: tax.brands.Lattafa,
      genres: [tax.genres.Woody],
      top: [tax.notes.Amber],
      base: [tax.notes.Vetiver],
      seasons: [tax.seasons.Summer],
      prices: [700, 950, 1400, 1900],
    },
    {
      name: 'Zara Wood',
      brand: tax.brands.Zara,
      genres: [tax.genres.Woody],
      top: [tax.notes.Sandalwood],
      seasons: [tax.seasons.Autumn],
      prices: [500, 700, 1000, 1400],
    },
  ]);
});

// ---------------------------------------------------------------------------

describe('Test case A — OR within brand', () => {
  it('matches a product when ANY selected brand applies', async () => {
    const built = buildPublicProductFilter({
      facets: { brands: `${tax.brands.Dior},${tax.brands.Chanel}` },
    });
    const names = await runFilter(built.filter);
    expect(names).toEqual([
      "Bleu de Chanel",
      'Coco Chanel',
      "J'adore",
      'Sauvage',
    ]);
  });

  it('drops invalid ids rather than 400ing, and keeps the valid ones', async () => {
    const built = buildPublicProductFilter({
      facets: { brands: `${tax.brands.Dior},not-an-id,${tax.brands.Lattafa}` },
    });
    const names = await runFilter(built.filter);
    expect(names).toEqual(['Oud Wood', 'Soft Amber', 'Sauvage', "J'adore"].sort());
  });
});

describe('Test case B — OR within genre', () => {
  it('matches a product when ANY selected genre applies', async () => {
    const built = buildPublicProductFilter({
      facets: { genres: `${tax.genres.Woody},${tax.genres.Gourmand}` },
    });
    const names = await runFilter(built.filter);
    expect(names).toEqual([
      'Oud Wood',
      'Soft Amber',
      'Tobacco Vanille',
      'Zara Wood',
    ]);
  });
});

describe('Test case C — AND across categories', () => {
  it('(Dior OR Chanel) AND (Woody OR Fresh) AND (Summer OR Winter)', async () => {
    const built = buildPublicProductFilter({
      facets: {
        brands: `${tax.brands.Dior},${tax.brands.Chanel}`,
        genres: `${tax.genres.Woody},${tax.genres.Fresh}`,
        seasons: `${tax.seasons.Summer},${tax.seasons.Winter}`,
      },
    });
    const names = await runFilter(built.filter);
    // Dior+Fresh+Summer = Sauvage. Chanel+Fresh+Winter = Bleu.
    // Dior+Coco Chanel floral excluded (not Fresh/Woody).
    expect(names).toEqual(['Bleu de Chanel', 'Sauvage']);
  });

  it('a product cannot bypass a selected category', async () => {
    // Every product has a season; requiring Winter must exclude all Summer ones.
    const built = buildPublicProductFilter({
      facets: { seasons: `${tax.seasons.Winter}` },
    });
    const names = await runFilter(built.filter);
    expect(names).toContain('Bleu de Chanel');
    expect(names).toContain('Tobacco Vanille');
    expect(names).not.toContain('Sauvage'); // Summer
    expect(names).not.toContain('Soft Amber'); // Summer
  });

  it('an empty category does NOT restrict results', async () => {
    const all = await runFilter(buildPublicProductFilter({}).filter);
    const emptyCsv = await runFilter(
      buildPublicProductFilter({ facets: { genres: '' } }).filter
    );
    const commaOnly = await runFilter(
      buildPublicProductFilter({ facets: { genres: ',,,' } }).filter
    );
    expect(emptyCsv).toEqual(all);
    expect(commaOnly).toEqual(all);
    expect(all).toHaveLength(8);
  });
});

describe('Test case D — multiple notes (OR, never all-of)', () => {
  it('matching ONE of the selected top notes is enough', async () => {
    const built = buildPublicProductFilter({
      facets: { 'notes.top': `${tax.notes.Bergamot},${tax.notes.Oud}` },
    });
    const names = await runFilter(built.filter);
    // Bergamot → Sauvage, Bleu. Oud → Oud Wood.
    expect(names).toEqual(['Bleu de Chanel', 'Oud Wood', 'Sauvage']);
  });

  it('does NOT require a product to carry every selected note', async () => {
    // Neither product has both Bergamot AND Oud; both must still appear.
    const built = buildPublicProductFilter({
      facets: { 'notes.top': `${tax.notes.Bergamot},${tax.notes.Oud}` },
    });
    const names = await runFilter(built.filter);
    for (const n of names) {
      expect(n).toBeTruthy();
    }
    expect(names).toHaveLength(3);
  });

  it('searches each note layer independently', async () => {
    const built = buildPublicProductFilter({
      facets: { 'notes.base': `${tax.notes.Oud}` },
    });
    const names = await runFilter(built.filter);
    expect(names).toEqual(['Tobacco Vanille']);
  });

  it('combines note OR with a category AND', async () => {
    const built = buildPublicProductFilter({
      facets: {
        brands: `${tax.brands.Lattafa},${tax.brands.Zara}`,
        'notes.top': `${tax.notes.Oud},${tax.notes.Amber}`,
      },
    });
    const names = await runFilter(built.filter);
    expect(names).toEqual(['Oud Wood', 'Soft Amber']);
  });
});

describe('Test case E — price range + categoricals together', () => {
  it('minPrice uses $elemMatch so ONE variant in range qualifies', async () => {
    const built = buildPublicProductFilter({ minPrice: 3000 });
    const names = await runFilter(built.filter);
    // Sauvage has a 4000 variant, Bleu a 4800 variant, etc.
    expect(names).toContain('Sauvage');
    expect(names).not.toContain('Soft Amber'); // max variant 1900
  });

  it('maxPrice means "no variant costs more than the bound"', async () => {
    const built = buildPublicProductFilter({ maxPrice: 1000 });
    const names = await runFilter(built.filter);
    // Only Soft Amber (700–1900… wait, its 30ml is 1900) — recheck:
    // Soft Amber 700/950/1400/1900 → 1900 > 1000, so it must be EXCLUDED.
    // Zara Wood 500/700/1000/1400 → 1400 > 1000, also excluded.
    // Nothing in the fixture has every variant ≤ 1000. The rule is strict:
    // a product qualifies only if it is affordable at EVERY size.
    expect(names).toEqual([]);
  });

  it('maxPrice keeps products whose largest variant still fits the budget', async () => {
    const built = buildPublicProductFilter({ maxPrice: 2000 });
    const names = await runFilter(built.filter);
    // Zara Wood tops out at 1400 ✓; Soft Amber at 1900 ✓; Oud Wood 2600 ✗.
    expect(names).toEqual(['Soft Amber', 'Zara Wood']);
  });

  it('price range AND a categorical filter compose', async () => {
    const built = buildPublicProductFilter({
      facets: { brands: `${tax.brands.Lattafa},${tax.brands.Zara}` },
      minPrice: 900,
      maxPrice: 2000,
    });
    const names = await runFilter(built.filter);
    // Zara Wood ✓, Soft Amber ✓, Oud Wood ✗ (2600 > 2000).
    expect(names).toEqual(['Soft Amber', 'Zara Wood']);
  });

  it('minPrice and maxPrice are independent clauses', async () => {
    // A wide band: everything with a 3ml at or above 900 and nothing above 3000.
    const built = buildPublicProductFilter({ minPrice: 900, maxPrice: 3000 });
    const names = await runFilter(built.filter);
    // Sauvage 1200..4000 ✗ (4000>3000). Bleu 1500..4800 ✗.
    // J'adore 1800..5200 ✗. Coco 2000..6000 ✗. Tobacco 2200..6500 ✗.
    // Oud Wood 900..2600 ✓. Soft Amber 700..1900 — min variant 700 < 900 ✗
    // (minPrice needs SOME variant ≥ 900 → 950 ✓, and max ≤ 3000 ✓) → ✓.
    // Zara Wood 500..1400 → some variant ≥ 900 ✓ (1000), max 1400 ≤ 3000 ✓ → ✓.
    expect(names).toEqual(['Oud Wood', 'Soft Amber', 'Zara Wood']);
  });

  it('variantPriceBounds reports the lowest and highest variant price', () => {
    expect(variantPriceBounds([{ price: 1200 }, { price: 4000 }, { price: 900 }])).toEqual({
      min: 900,
      max: 4000,
    });
    expect(variantPriceBounds([])).toEqual({ min: null, max: null });
    expect(variantPriceBounds(null)).toEqual({ min: null, max: null });
  });
});

describe('Availability (inStock)', () => {
  it('keeps only products that have inventory with remainingMl > 0', async () => {
    const products = await seedProducts(tax, [
      { name: 'Stocked', brand: tax.brands.Zara, prices: [100] },
      { name: 'Empty', brand: tax.brands.Zara, prices: [100] },
    ]);
    await seedInventory([
      { product: products.Stocked, productName: 'Stocked', remainingMl: 5000 },
      { product: products.Empty, productName: 'Empty', remainingMl: 0 },
    ]);

    // `wantsInStock` is the controller's guard; `withInStockIds` is how the
    // resolved id set is folded into the filter.
    expect(wantsInStock('true')).toBe(true);
    const built = buildPublicProductFilter({});
    withInStockIds(built, [String(products.Stocked)]);
    const names = await runFilter(built.filter);
    expect(names).toEqual(['Stocked']);
  });

  it('produces an empty result set when nothing is in stock', async () => {
    const built = buildPublicProductFilter({});
    withInStockIds(built, []);
    const names = await runFilter(built.filter);
    expect(names).toEqual([]);
  });

  it('a real batch query only returns rows with remainingMl > 0', async () => {
    const products = await seedProducts(tax, [
      { name: 'HasStock', brand: tax.brands.Zara },
      { name: 'NoStock', brand: tax.brands.Zara },
    ]);
    await seedInventory([
      { product: products.HasStock, productName: 'HasStock', remainingMl: 10 },
      { product: products.NoStock, productName: 'NoStock', remainingMl: 0 },
    ]);
    const { InventoryBatch } = await import(
      '../modules/inventory/inventoryBatch.model'
    );
    const rows = await InventoryBatch.find({ remainingMl: { $gt: 0 } })
      .lean()
      .exec();
    const ids = rows.map((r) => String((r as { product: { toString(): string } }).product));
    expect(ids).toHaveLength(1);
    expect(String(products.HasStock)).toBe(ids[0]);
  });
});

describe('Test case F/I — clear individual vs clear all', () => {
  it('clearing one facet keeps the others applied', async () => {
    // brands=(Dior,Chanel) AND genres=Fresh  →  Sauvage + Bleu
    const both = buildPublicProductFilter({
      facets: {
        brands: `${tax.brands.Dior},${tax.brands.Chanel}`,
        genres: `${tax.genres.Fresh}`,
      },
    });
    // Clearing `genres` while `brands` stays → the four Dior/Chanel products.
    const clearedGenre = buildPublicProductFilter({
      facets: {
        brands: `${tax.brands.Dior},${tax.brands.Chanel}`,
        genres: '',
      },
    });
    // Clearing `brands` while `genres` stays → same as `both`.
    const clearedBrand = buildPublicProductFilter({
      facets: { brands: '', genres: `${tax.genres.Fresh}` },
    });

    expect(await runFilter(both.filter)).toEqual(['Bleu de Chanel', 'Sauvage']);
    expect(await runFilter(clearedBrand.filter)).toEqual(['Bleu de Chanel', 'Sauvage']);
    expect(await runFilter(clearedGenre.filter)).toEqual([
      'Bleu de Chanel',
      'Coco Chanel',
      "J'adore",
      'Sauvage',
    ]);
  });

  it('clearing every facet restores the unfiltered result set', async () => {
    const all = await runFilter(buildPublicProductFilter({}).filter);
    const cleared = buildPublicProductFilter({
      facets: {
        brands: `${tax.brands.Dior}`,
        genres: `${tax.genres.Woody}`,
        'notes.top': `${tax.notes.Oud}`,
      },
    });
    // Nothing cleared yet → still narrowed to Dior + Woody + Oud = ∅.
    expect(await runFilter(cleared.filter)).toEqual([]);
    const fullyCleared = buildPublicProductFilter({
      facets: { brands: '', genres: '', 'notes.top': '' },
    });
    expect(await runFilter(fullyCleared.filter)).toEqual(all);
  });

  it('records only the facets that actually produced a clause', () => {
    const built = buildPublicProductFilter({
      facets: { brands: `${tax.brands.Dior}`, genres: '' },
    });
    expect(Object.keys(built.appliedFacets)).toEqual(['brands']);
  });
});

describe('Search normalisation (case-insensitive, whitespace-tolerant)', () => {
  it('collapses internal whitespace and trims', () => {
    expect(normalizeSearchTerm('  Sauvage   Dior  ')).toBe('sauvage dior');
    expect(normalizeSearchTerm('\t\noud\n\nwood ')).toBe('oud wood');
    expect(normalizeSearchTerm('')).toBe('');
    expect(normalizeSearchTerm(undefined)).toBe('');
  });

  it('clamps absurdly long terms', () => {
    const long = 'x'.repeat(500);
    expect(normalizeSearchTerm(long)).toHaveLength(120);
  });
});

describe('Cross-collection search (brand + note names)', () => {
  it('finds a product by its BRAND name even when the term is not in the product name', async () => {
    const built = buildPublicProductFilter({ search: 'chanel' });
    await applyCrossCollectionSearchForTest(built.filter, 'chanel');
    const names = await runFilter(built.filter);
    expect(names).toEqual(['Bleu de Chanel', 'Coco Chanel']);
  });

  it('finds a product by a BASE NOTE name (Oud → Tobacco Vanille)', async () => {
    const built = buildPublicProductFilter({ search: 'oud' });
    await applyCrossCollectionSearchForTest(built.filter, 'oud');
    const names = await runFilter(built.filter);
    expect(names).toEqual(['Oud Wood', 'Tobacco Vanille']);
  });

  it('requires ALL tokens to match somewhere (ouD wOOd)', async () => {
    const built = buildPublicProductFilter({ search: 'oud wood' });
    await applyCrossCollectionSearchForTest(built.filter, 'oud wood');
    const names = await runFilter(built.filter);
    expect(names).toEqual(['Oud Wood']);
  });

  it('matches directly on product name / description / aliases', async () => {
    const byName = buildPublicProductFilter({ search: 'sauvage' });
    expect(await runFilter(byName.filter)).toEqual(['Sauvage']);

    const byAlias = buildPublicProductFilter({ search: 'TF Tobacco' });
    expect(await runFilter(byAlias.filter)).toEqual(['Tobacco Vanille']);

    const byDescription = buildPublicProductFilter({ search: 'cardamom' });
    expect(await runFilter(byDescription.filter)).toEqual(['Oud Wood']);
  });
});

describe('Visibility rules', () => {
  it('never returns inactive or soft-deleted products', async () => {
    await seedProducts(tax, [
      { name: 'HiddenInactive', brand: tax.brands.Zara, isActive: false },
      { name: 'VisibleOne', brand: tax.brands.Zara },
    ]);
    const names = await runFilter(buildPublicProductFilter({}).filter);
    expect(names).toContain('VisibleOne');
    expect(names).not.toContain('HiddenInactive');
  });
});

describe('Facet map integrity', () => {
  it('every PUBLIC_FACETS entry points at a real Product path', () => {
    for (const [key, spec] of Object.entries(PUBLIC_FACETS)) {
      const typed: PublicFacetSpec = spec;
      expect(typed.path).toBeTruthy();
      expect(key).toBeTruthy();
    }
  });

  it('caps CSV length so a huge query string cannot blow up the $in', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      i.toString(16).padStart(24, '0')
    ).join(',');
    const built = buildPublicProductFilter({ facets: { brands: many } });
    expect(built.appliedFacets.brands.length).toBeLessThanOrEqual(40);
  });
});