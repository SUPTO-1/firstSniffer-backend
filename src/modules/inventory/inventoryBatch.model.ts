import mongoose, { Schema, type Model } from 'mongoose';
import type { IInventoryBatch, InventoryBatchDoc } from './inventoryBatch.interface';

/**
 * InventoryBatch — the physical stock ledger.
 *
 * One row per PURCHASE, not per selling size. A product may have many
 * batches (several bottles bought over time); every selling variant of that
 * product draws from all of them via FIFO.
 *
 *  - `totalMl` is derived (`sourceBottleSizeMl * quantity`) by the service
 *    layer. It is stored so product-level aggregation is a single indexed
 *    scan rather than a recompute.
 *  - `remainingMl` is the canonical "available to sell" number for THIS
 *    batch. It can never go negative: every decrement path uses the atomic
 *    conditional update `{ remainingMl: { $gte: ml } }`.
 *  - `isActive: false` retires a fully-consumed batch without deleting it,
 *    so the movement history stays intact.
 *
 * There is deliberately NO unique index on (product, …) — multiple batches
 * per product is the entire point of this model.
 */

const ObjectId = mongoose.Schema.Types.ObjectId;

const InventoryBatchSchema = new Schema<InventoryBatchDoc>(
  {
    product: {
      type: ObjectId,
      ref: 'Product',
      required: [true, 'Product is required'],
      index: true,
    },
    productName: {
      type: String,
      required: [true, 'Product name snapshot is required'],
      trim: true,
      index: true,
    },
    /** Capacity of ONE original bottle in ml. Numeric so any size works. */
    sourceBottleSizeMl: {
      type: Number,
      required: [true, 'Original bottle size is required'],
      min: [1, 'Original bottle size must be at least 1 ml'],
    },
    /** How many original bottles this batch contains. */
    quantity: {
      type: Number,
      required: [true, 'Number of bottles is required'],
      min: [1, 'Number of bottles must be at least 1'],
    },
    /** Derived: sourceBottleSizeMl * quantity. */
    totalMl: {
      type: Number,
      required: [true, 'Total ml is required'],
      min: [0, 'Total ml cannot be negative'],
    },
    /** Sellable liquid left in this batch. */
    remainingMl: {
      type: Number,
      required: [true, 'Remaining ml is required'],
      min: [0, 'Remaining ml cannot be negative'],
    },
    /** TOTAL cost paid for the whole batch. */
    purchaseCost: {
      type: Number,
      required: [true, 'Purchase cost is required'],
      min: [0, 'Purchase cost cannot be negative'],
    },
    /** Drives FIFO consumption order (oldest purchase consumed first). */
    purchaseDate: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    supplier: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    /** Traceability marker for rows created by the legacy-data migration. */
    migratedFrom: {
      type: ObjectId,
      ref: 'Inventory',
    },
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

// FIFO scan: "which batches can serve this product, oldest purchase first".
InventoryBatchSchema.index({ product: 1, purchaseDate: 1, _id: 1 });

// Availability: aggregate the remaining ml of a product's active batches.
InventoryBatchSchema.index({ product: 1, remainingMl: 1 });

// Active-batch filter used by the product-level stock rollup.
InventoryBatchSchema.index({ product: 1, isActive: 1 });

export const InventoryBatch: Model<InventoryBatchDoc> =
  (mongoose.models.InventoryBatch as Model<InventoryBatchDoc>) ||
  mongoose.model<InventoryBatchDoc>('InventoryBatch', InventoryBatchSchema);
