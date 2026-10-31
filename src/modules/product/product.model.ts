import mongoose, { Schema, type Model } from 'mongoose';
import { generateUniqueSlug } from '../../utils/slugify';
import type { IProduct, ProductDoc } from './product.interface';

/**
 * Product — first cross-collection module (references Brand + 7 others).
 * Variants are a nested array (mirrors the Atomizer→sizes pattern).
 * Multi-image gallery lives on `images[]` and is edited through a dedicated
 * PATCH `/products/:id/images` endpoint so per-file ImageKit cleanup can
 * fire on remove.
 *
 * Soft-delete: `isActive: false` + `deletedAt: Date` (defaults to null).
 * Listed endpoints filter `deletedAt: null` by default; `?includeDeleted=true`
 * shows them so an admin can find and restore them.
 */

const ProductImageSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    fileId: { type: String, required: true },
    alt: { type: String, trim: true, maxlength: 200, default: '' },
  },
  { _id: false }
);

const ProductVariantSchema = new Schema(
  {
    size: {
      type: String,
      required: true,
      enum: ['3ml', '5ml', '10ml', '15ml', '30ml'],
    },
    price: { type: Number, required: true, min: 0 },
    /**
     * Admin toggle for a selling size. A disabled variant is hidden from the
     * storefront and rejected by the order pipeline, but its price history is
     * preserved — unlike deleting the variant entirely.
     *
     * Defaults to `true`, so every existing row keeps selling without a
     * data migration.
     */
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const ProductPerformanceSchema = new Schema(
  {
    longevity: {
      type: String,
      enum: ['low', 'moderate', 'long-lasting', 'eternal'],
      default: 'moderate',
    },
    projection: {
      type: String,
      enum: ['soft', 'moderate', 'strong', 'beast-mode'],
      default: 'moderate',
    },
    versatility: {
      type: String,
      enum: ['niche', 'moderate', 'versatile'],
      default: 'moderate',
    },
  },
  { _id: false }
);

const ObjectId = mongoose.Schema.Types.ObjectId;

const ProductNotesSchema = new Schema(
  {
    top: [{ type: ObjectId, ref: 'Note' }],
    middle: [{ type: ObjectId, ref: 'Note' }],
    base: [{ type: ObjectId, ref: 'Note' }],
  },
  { _id: false }
);

const ProductSchema = new Schema<ProductDoc>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [120, 'Name is too long'],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    brand: {
      type: ObjectId,
      ref: 'Brand',
      required: true,
      index: true,
    },
    genres: [{ type: ObjectId, ref: 'Genre', index: true }],
    description: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: '',
    },
    notes: { type: ProductNotesSchema, default: () => ({}) },
    gender: {
      type: String,
      enum: ['masculine', 'feminine', 'unisex'],
      default: 'unisex',
    },
    seasons: [{ type: ObjectId, ref: 'Season' }],
    occasions: [{ type: ObjectId, ref: 'Occasion' }],
    weathers: [{ type: ObjectId, ref: 'Weather' }],
    times: [{ type: ObjectId, ref: 'Time' }],
    performance: {
      type: ProductPerformanceSchema,
      default: () => ({ longevity: 'moderate', projection: 'moderate', versatility: 'moderate' }),
    },
    images: { type: [ProductImageSchema], default: [] },
    variants: {
      type: [ProductVariantSchema],
      required: true,
      validate: {
        validator: (arr: unknown[]) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one variant is required',
      },
    },
    defaultAtomizer: { type: ObjectId, ref: 'Atomizer' },
    aliases: { type: [String], default: [] },

    /* ---------- Product-level inventory settings ----------
     *
     * The physical stock lives in `InventoryBatch` rows (one per purchase).
     * These two numbers are properties of the PRODUCT's sellable position,
     * not of any particular purchase, so they live here rather than on the
     * batch.
     *
     * `safetyBufferMl` is a seller-owned margin that is held back from sale.
     * It is genuinely enforced: sellable = Σ batch.remainingMl − safetyBufferMl.
     * It is NOT an order reservation — reserved stock is tracked separately
     * (see the order pipeline's `availableMl` reporting).
     */
    safetyBufferMl: { type: Number, default: 0, min: 0 },
    lowStockThresholdMl: { type: Number, default: 30, min: 0 },

    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    featured: { type: Boolean, default: false, index: true },
    bestSelling: { type: Boolean, default: false, index: true },
    topRated: { type: Boolean, default: false, index: true },
    newArrival: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Pre-validate hook: auto-generate the slug from `name` if not provided.
// Reuses the project-wide `generateUniqueSlug` so slug-dedupe stays consistent.
ProductSchema.pre('validate', async function () {
  if (this.isModified('name') && (!this.isModified('slug') || !this.slug)) {
    this.slug = await generateUniqueSlug(this.constructor as Model<IProduct>, {
      name: this.name,
      excludeId: this._id,
    });
  }
});

// Defense-in-depth: Zod already disallows duplicate variant sizes, but
// throwing inside `pre('validate')` surfaces it as a clean ValidationError.
ProductSchema.pre('validate', function () {
  if (Array.isArray(this.variants)) {
    const sizes = (this.variants as Array<{ size: string }>).map((v) => v.size);
    if (new Set(sizes).size !== sizes.length) {
      this.invalidate('variants', 'Duplicate variant sizes are not allowed');
    }
  }
});

// ---------------------------------------------------------------------------
// Faceted-search indexes.
//
// The storefront filters with OR-within / AND-across across nine facet paths
// plus a price range on `variants.price` and an optional `_id $in` for stock.
// Every one of those paths is an equality / `$in` match, so a single-field
// index per path lets the planner intersect them. Text search is a leading-
// wildcard regex and can't use a B-tree, so `name` gets a case-insensitive
// collation index instead (helps exact-prefix + equality lookups).
// ---------------------------------------------------------------------------
ProductSchema.index({ name: 1, _id: 1 });
ProductSchema.index({ seasons: 1 });
ProductSchema.index({ occasions: 1 });
ProductSchema.index({ weathers: 1 });
ProductSchema.index({ times: 1 });
ProductSchema.index({ 'notes.top': 1 });
ProductSchema.index({ 'notes.middle': 1 });
ProductSchema.index({ 'notes.base': 1 });
ProductSchema.index({ aliases: 1 });
ProductSchema.index({ 'variants.price': 1 });
ProductSchema.index({ gender: 1 });
// Covers the default storefront listing (active, undeleted, newest first).
ProductSchema.index({ isActive: 1, deletedAt: 1, createdAt: -1 });
// Supports the availability path and the admin product-id lookups.
ProductSchema.index({ brand: 1, isActive: 1, deletedAt: 1 });

// Cascade: when a Product is renamed, the denormalised `productName` on
// any inventory rows must follow — otherwise search by product name breaks.
// Best-effort, fire-and-forget so a transient Mongo error doesn't block the save.
const cascadeProductNameUpdate = async (
  doc: ProductDoc | null
): Promise<void> => {
  if (!doc) return;
  try {
    // Inventory modules are imported lazily to avoid a circular dependency
    // (inventory → product → inventory). Use a runtime require so the build
    // doesn't fail on the import cycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = eval('require') as NodeRequire;

    const batchMod = req('../inventory/inventoryBatch.model');
    const InventoryBatch = batchMod.InventoryBatch;
    if (InventoryBatch) {
      await InventoryBatch.updateMany(
        { product: doc._id },
        { $set: { productName: doc.name } }
      );
    }

    // Legacy collection — kept in sync so the archived rows stay searchable
    // during the migration window.
    const legacyMod = req('../inventory/inventory.model');
    const Inventory = legacyMod.Inventory;
    if (Inventory) {
      await Inventory.updateMany(
        { product: doc._id },
        { $set: { productName: doc.name } }
      );
    }
  } catch {
    // Best-effort: the product name update succeeded; an out-of-date snapshot
    // is acceptable until the next inventory edit (which re-syncs).
  }
};

ProductSchema.post('save', function (doc) {
  void cascadeProductNameUpdate(doc);
});

ProductSchema.post('findOneAndUpdate', function (doc) {
  const updated = doc as ProductDoc | null;
  void cascadeProductNameUpdate(updated);
});

export const Product: Model<ProductDoc> =
  (mongoose.models.Product as Model<ProductDoc>) ||
  mongoose.model<ProductDoc>('Product', ProductSchema);
