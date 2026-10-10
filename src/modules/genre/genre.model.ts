import mongoose, { Schema, type Model } from 'mongoose';
import { generateUniqueSlug } from '../../utils/slugify';
import type { IGenre, GenreDoc } from './genre.interface';

const GenreSchema = new Schema<GenreDoc>(
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

GenreSchema.pre('validate', async function () {
  if (this.isModified('name') && (!this.isModified('slug') || !this.slug)) {
    this.slug = await generateUniqueSlug(this.constructor as Model<IGenre>, {
      name: this.name,
      excludeId: this._id,
    });
  }
});

export const Genre: Model<GenreDoc> =
  (mongoose.models.Genre as Model<GenreDoc>) ||
  mongoose.model<GenreDoc>('Genre', GenreSchema);
