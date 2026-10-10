import mongoose, { Schema, type Model } from 'mongoose';
import { generateUniqueSlug } from '../../utils/slugify';
import type { IAtomizer, AtomizerDoc } from './atomizer.interface';

const AtomizerSizeSchema = new Schema(
  {
    size: { type: String, required: [true, 'Size label is required'], trim: true, maxlength: 40 },
    additionalPrice: { type: Number, required: [true, 'Additional price is required'], min: 0 },
  },
  { _id: false }
);

const AtomizerSchema = new Schema<AtomizerDoc>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name is too long'],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    image: { type: String, required: [true, 'Image is required'], trim: true },
    imageFileId: { type: String, required: true },
    sizes: {
      type: [AtomizerSizeSchema],
      required: true,
      validate: {
        validator: (arr: unknown[]) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one size is required',
      },
    },
    isActive: { type: Boolean, default: true },
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

AtomizerSchema.pre('validate', async function () {
  if (this.isModified('name') && (!this.isModified('slug') || !this.slug)) {
    this.slug = await generateUniqueSlug(this.constructor as Model<IAtomizer>, {
      name: this.name,
      excludeId: this._id,
    });
  }
});

export const Atomizer: Model<AtomizerDoc> =
  (mongoose.models.Atomizer as Model<AtomizerDoc>) ||
  mongoose.model<AtomizerDoc>('Atomizer', AtomizerSchema);