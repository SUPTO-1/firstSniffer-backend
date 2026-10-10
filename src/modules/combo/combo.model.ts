import mongoose, { Schema, type Model } from 'mongoose';
import type { ICombo, ComboDoc } from './combo.interface';

const ComboProductSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    size: {
      type: String,
      required: true,
      enum: ['3ml', '5ml', '10ml', '30ml'],
    },
    millilitres: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const ComboSchema = new Schema<ComboDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    products: { type: [ComboProductSchema], default: [] },
    comboPrice: { type: Number, required: true, min: 0 },
    image: {
      url: { type: String, default: '' },
      fileId: { type: String, default: '' },
    },
    isActive: { type: Boolean, default: true, index: true },
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

export const Combo: Model<ComboDoc> =
  (mongoose.models.Combo as Model<ComboDoc>) ||
  mongoose.model<ComboDoc>('Combo', ComboSchema);