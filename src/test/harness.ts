import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Product } from '../modules/product/product.model';
import { Inventory } from '../modules/inventory/inventory.model';
import { Brand } from '../modules/brand/brand.model';
import { Note } from '../modules/note/note.model';
import { Genre } from '../modules/genre/genre.model';
import { Season } from '../modules/season/season.model';
import { Occasion } from '../modules/occasion/occasion.model';
import { Weather } from '../modules/weather/weather.model';
import { Time } from '../modules/timeofday/time.model';

/**
 * Shared Mongo-backed test harness.
 *
 * These are INTEGRATION tests, not mocks: the whole point of the master
 * prompt's filtering rule is that Mongo's query semantics are correct, and
 * `$in` vs implicit-AND behaviour can't be verified against a fake. A real
 * mongod is the only honest way to prove Test Cases A–E.
 *
 * Connection strategy — prefers an EXTERNAL mongod over booting a second one:
 *   1. `MONGODB_TEST_URI` if set (used by CI).
 *   2. The app's own `MONGODB_URI`, but rewritten to a throwaway
 *      `firstsniffer_test` database. Every test truncates its collections in
 *      `beforeEach`, so the dev/dev data is never at risk — but the database
 *      name still guarantees we can't clobber `firstsniffer` by accident.
 *   3. `MongoMemoryServer` as a last resort.
 *
 * Booting an in-memory server on this machine was the single biggest source of
 * flakiness (the mongod download + a second mongod process exhausted memory),
 * so option 2 is strongly preferred.
 */

let memoryServer: MongoMemoryServer | null = null;

const TEST_DB_NAME = 'firstsniffer_test';

function rewriteToTestDb(uri: string): string {
  try {
    const url = new URL(uri);
    url.pathname = `/${TEST_DB_NAME}`;
    // Docker publishes Mongo on IPv4 only; on Node 18+ `localhost` resolves to
    // ::1 first and the connection dies with `ServerSelectionError ... [::1]`.
    // Pin to 127.0.0.1 so server selection succeeds.
    if (url.hostname === 'localhost' || url.hostname === '[::1]') {
      url.hostname = '127.0.0.1';
    }
    return url.toString();
  } catch {
    return uri;
  }
}

/** Boot (or connect to) Mongo and connect mongoose. Call once per test file. */
export async function connectTestDb(): Promise<void> {
  const external =
    process.env.MONGODB_TEST_URI ??
    (process.env.MONGODB_URI ? rewriteToTestDb(process.env.MONGODB_URI) : '');

  if (external) {
    await mongoose.connect(external, { dbName: TEST_DB_NAME, serverSelectionTimeoutMS: 10_000 });
    return;
  }

  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri(), { dbName: TEST_DB_NAME });
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

export async function clearTestDb(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

// ---------------------------------------------------------------------------
// Master-data fixtures — ids are captured so tests can reference them.
// ---------------------------------------------------------------------------

export interface TaxonomyFixture {
  brands: Record<string, mongoose.Types.ObjectId>;
  notes: Record<string, mongoose.Types.ObjectId>;
  genres: Record<string, mongoose.Types.ObjectId>;
  seasons: Record<string, mongoose.Types.ObjectId>;
  occasions: Record<string, mongoose.Types.ObjectId>;
  weathers: Record<string, mongoose.Types.ObjectId>;
  times: Record<string, mongoose.Types.ObjectId>;
}

/** Minimal field sets the models require (see each *.model.ts). */
const brandRows = ['Dior', 'Chanel', 'Tom Ford', 'Lattafa', 'Zara'];
const noteRows = ['Oud', 'Bergamot', 'Rose', 'Vanilla', 'Sandalwood', 'Amber', 'Cedarwood', 'Vetiver', 'Jasmine', 'Tonka Bean'];
const genreRows = ['Woody', 'Fresh', 'Floral', 'Gourmand'];
const seasonRows = ['Summer', 'Winter', 'Spring', 'Autumn'];
const occasionRows = ['Daily', 'Party', 'Office', 'Date Night'];
const weatherRows = ['Hot', 'Cold', 'Rainy', 'Cloudy'];
const timeRows = ['Day', 'Night', 'Morning', 'Evening'];

/** Brand uses `logo`; every other taxonomy model uses `image`. */
function mediaFields(name: string, isBrand: boolean): Record<string, string> {
  return {
    ...(isBrand
      ? { logo: `https://img.test/${name}.png` }
      : { image: `https://img.test/${name}.png` }),
    imageFileId: `file_${name.replace(/\s+/g, '_')}`,
  };
}

export async function seedTaxonomy(): Promise<TaxonomyFixture> {
  // Every taxonomy model has the same `{name, slug, image fields, isActive}`
  // create-shape, but their TS interfaces differ (Brand has `logo`,
  // `isFeatured`; Genre/Season/etc. have `image`). Typing the param as
  // `typeof Brand` makes the other six fail to typecheck, so we accept any
  // model with a compatible `create` and cast at the boundary — these are
  // test fixtures, and the runtime shapes are uniform.
  const mk = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Model: any,
    names: string[],
    isBrand = false
  ): Promise<Record<string, mongoose.Types.ObjectId>> => {
    const out: Record<string, mongoose.Types.ObjectId> = {};
    for (const name of names) {
      const doc = await Model.create({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        ...(name === 'Dior' ? { isFeatured: true } : {}),
        ...mediaFields(name, isBrand),
      });
      out[name] = doc._id;
    }
    return out;
  };

  return {
    brands: await mk(Brand, brandRows, true),
    notes: await mk(Note, noteRows),
    genres: await mk(Genre, genreRows),
    seasons: await mk(Season, seasonRows),
    occasions: await mk(Occasion, occasionRows),
    weathers: await mk(Weather, weatherRows),
    times: await mk(Time, timeRows),
  };
}

export interface ProductSpec {
  name: string;
  brand: mongoose.Types.ObjectId;
  genres?: mongoose.Types.ObjectId[];
  top?: mongoose.Types.ObjectId[];
  middle?: mongoose.Types.ObjectId[];
  base?: mongoose.Types.ObjectId[];
  seasons?: mongoose.Types.ObjectId[];
  occasions?: mongoose.Types.ObjectId[];
  weathers?: mongoose.Types.ObjectId[];
  times?: mongoose.Types.ObjectId[];
  /** Variant prices — index 0 is used by price sorting. */
  prices?: number[];
  aliases?: string[];
  description?: string;
  gender?: 'masculine' | 'feminine' | 'unisex';
  isActive?: boolean;
}

export async function seedProducts(
  tax: TaxonomyFixture,
  specs: ProductSpec[]
): Promise<Record<string, mongoose.Types.ObjectId>> {
  const ids: Record<string, mongoose.Types.ObjectId> = {};
  const sizes = ['3ml', '5ml', '10ml', '30ml'] as const;
  for (const spec of specs) {
    const prices = spec.prices ?? [1000];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = await (Product as any).create({
      name: spec.name,
      brand: spec.brand,
      genres: spec.genres ?? [],
      notes: { top: spec.top ?? [], middle: spec.middle ?? [], base: spec.base ?? [] },
      seasons: spec.seasons ?? [],
      occasions: spec.occasions ?? [],
      weathers: spec.weathers ?? [],
      times: spec.times ?? [],
      description: spec.description ?? '',
      gender: spec.gender ?? 'unisex',
      aliases: spec.aliases ?? [],
      isActive: spec.isActive ?? true,
      images: [{ url: 'https://img.test/p.png', fileId: 'file_p' }],
      variants: sizes.map((size, i) => ({ size, price: prices[i] ?? prices[prices.length - 1] })),
    });
    ids[spec.name] = doc._id;
  }
  return ids;
}

export async function seedInventory(
  rows: Array<{ product: mongoose.Types.ObjectId; productName: string; remainingMl: number }>
): Promise<void> {
  for (const r of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (Inventory as any).create({
      product: r.product,
      productName: r.productName,
      bottleSize: '10ml',
      totalMl: 100000,
      reservedBufferMl: 0,
      remainingMl: r.remainingMl,
      purchaseCost: 100,
      lowStockThresholdMl: 1000,
    });
  }
}

/** Convenience: run the built filter against Mongo and return matching names. */
export async function runFilter(
  filter: mongoose.FilterQuery<unknown>
): Promise<string[]> {
  const rows = await Product.find(filter).sort({ name: 1 }).lean().exec();
  return rows.map((r) => String((r as { name: string }).name));
}