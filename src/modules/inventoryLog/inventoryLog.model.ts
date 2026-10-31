import mongoose, { Schema, type Model } from 'mongoose';
import type { IInventoryLog, InventoryLogDoc } from './inventoryLog.interface';

/**
 * InventoryLog — append-only audit trail for every stock movement. The
 * inventory service writes one of these alongside each batch mutation;
 * clients never write directly.
 *
 * Append-only: no update / delete endpoints exposed. Removing logs would
 * break the audit guarantee, so the only way a log row disappears is a
 * whole-collection purge (admin operation, future).
 *
 * The `inventory` field points at an `InventoryBatch` — the log is
 * BATCH-level, which is what makes a multi-batch order traceable and
 * exactly reversible.
 */

const ObjectId = mongoose.Schema.Types.ObjectId;

const InventoryLogSchema = new Schema<InventoryLogDoc>(
  {
    inventory: {
      type: ObjectId,
      ref: 'InventoryBatch',
      required: [true, 'Inventory batch reference is required'],
      index: true,
    },
    product: {
      type: ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Log type is required'],
      enum: ['add', 'sale', 'reversal', 'adjustment', 'restock', 'retire'],
      index: true,
    },
    quantityMl: {
      type: Number,
      required: [true, 'Quantity ml is required'],
      min: [0, 'Quantity cannot be negative'],
    },
    referenceId: { type: String, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    createdBy: {
      type: ObjectId,
      ref: 'User',
      index: true,
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

export const InventoryLog: Model<InventoryLogDoc> =
  (mongoose.models.InventoryLog as Model<InventoryLogDoc>) ||
  mongoose.model<InventoryLogDoc>('InventoryLog', InventoryLogSchema);