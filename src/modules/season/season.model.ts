import mongoose, { Schema, type Model } from 'mongoose';
import { generateUniqueSlug } from '../../utils/slugify';
import type { ISeason, SeasonDoc } from './season.interface';

const SeasonSchema = new Schema<SeasonDoc>(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    image: { type: String, required: [true, 'Image is required'], trim: true },
    imageFileId: { type: String, required: true },
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

SeasonSchema.pre('validate', async function () {
  if (this.isModified('name') && (!this.isModified('slug') || !this.slug)) {
    this.slug = await generateUniqueSlug(this.constructor as Model<ISeason>, { name: this.name, excludeId: this._id });
  }
});

export const Season: Model<SeasonDoc> =
  (mongoose.models.Season as Model<SeasonDoc>) ||
  mongoose.model<SeasonDoc>('Season', SeasonSchema);
