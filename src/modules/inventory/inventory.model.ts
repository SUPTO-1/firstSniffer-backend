import mongoose, { Schema, type Model } from 'mongoose';
import type { IInventory, InventoryDoc } from './inventory.interface';

/**
 * Inventory — stock ledger per product+size.
 *
 *  - One row per (product, bottleSize) pair (compound unique index).
 *  - `remainingMl` is the canonical "available to sell" number; never
 *    goes negative thanks to the atomic conditional update used by every
 *    decrement path in the service layer.
 *  - `reservedBufferMl` is ml that's been pre-allocated to pending orders —
 *    counts toward "stocked" but isn't sellable until released.
 *  - `status` is computed at read time (no persistence) from remainingMl vs
 *    totalMl / lowStockThresholdMl — keeps the data model clean.
 *  - `productName` is a denormalised snapshot updated by a hook on Product
 *    so the inventory search bar can match by product name without an extra
 *    populate + $lookup.
 */

const ObjectId = mongoose.Schema.Types.ObjectId;

const InventorySchema = new Schema<InventoryDoc>(
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
    bottleSize: {
      type: String,
      required: [true, 'Bottle size is required'],
      enum: ['3ml', '5ml', '10ml', '30ml'],
    },
    totalMl: {
      type: Number,
      required: [true, 'Total ml is required'],
      min: [0, 'Total ml cannot be negative'],
    },
    reservedBufferMl: {
      type: Number,
      required: true,
      min: [0, 'Reserved buffer cannot be negative'],
      default: 0,
    },
    remainingMl: {
      type: Number,
      required: [true, 'Remaining ml is required'],
      min: [0, 'Remaining ml cannot be negative'],
    },
    purchaseCost: {
      type: Number,
      required: [true, 'Purchase cost is required'],
      min: [0, 'Purchase cost cannot be negative'],
    },
    lowStockThresholdMl: {
      type: Number,
      required: true,
      min: 0,
      default: 30,
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

// Compound unique: one batch per (product, bottleSize). Adding another 30ml
// batch to an existing product+30ml row would silently update — admin must
// adjust the existing row instead.
InventorySchema.index({ product: 1, bottleSize: 1 }, { unique: true });

export const Inventory: Model<InventoryDoc> =
  (mongoose.models.Inventory as Model<InventoryDoc>) ||
  mongoose.model<InventoryDoc>('Inventory', InventorySchema);
