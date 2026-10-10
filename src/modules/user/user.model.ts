import mongoose, { Schema, type Model } from 'mongoose';
import type { IAddress, IUser, UserDoc } from './user.interface';

const AddressSchema = new Schema<IAddress>(
  {
    label: { type: String, trim: true, default: 'Home' },
    district: { type: String, trim: true, required: true },
    area: { type: String, trim: true, required: true },
    address: { type: String, trim: true, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const UserSchema = new Schema<UserDoc>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    nickname: {
      type: String,
      trim: true,
      maxlength: 40,
      default: null,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      // sparse + unique means: documents without an email don't collide
      // on the unique index, but two users with the same email cannot exist.
      index: { unique: true, sparse: true },
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },

    password: {
      type: String,
      default: null,
      select: false,
    },

    role: {
      type: String,
      enum: ['admin', 'customer'],
      default: 'customer',
    },

    isGuest: {
      type: Boolean,
      default: false,
    },

    addresses: {
      type: [AddressSchema],
      default: [],
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
        delete ret.password; // never serialise password
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.password;
        return ret;
      },
    },
  }
);

// Note: the unique-sparse index declared on `email` above already
// provides an index on the field — no need for a second one.

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ||
  mongoose.model<UserDoc>('User', UserSchema);
