import mongoose, { Schema, type Model } from 'mongoose';
import { generateUniqueSlug } from '../../utils/slugify';
import type { IBrand, BrandDoc } from './brand.interface';

const BrandSchema = new Schema<BrandDoc>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
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
    logo: {
      type: String,
      required: [true, 'Logo is required'],
      trim: true,
    },
    imageFileId: {
      type: String,
      required: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
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

/**
 * Auto-generate a unique slug when name changes and the admin hasn't manually
 * overwritten slug. Fires on both create and update.
 */
BrandSchema.pre('validate', async function () {
  if (this.isModified('name') && (!this.isModified('slug') || !this.slug)) {
    this.slug = await generateUniqueSlug(
      this.constructor as Model<IBrand>,
      {
        name: this.name,
        excludeId: this._id,
      }
    );
  }
});

export const Brand: Model<BrandDoc> =
  (mongoose.models.Brand as Model<BrandDoc>) ||
  mongoose.model<BrandDoc>('Brand', BrandSchema);
