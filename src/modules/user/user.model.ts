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
      // NO `default: null` ON PURPOSE.
      //
      // A MongoDB `sparse` index skips documents where the field is
      // ABSENT — but it does NOT skip an explicit `null`. With
      // `default: null`, Mongoose writes `email: null` into every
      // document, so the second user to be created without an email
      // would fail with E11000 (duplicate key) on this unique index.
      //
      // That is not hypothetical: GUEST checkout creates a user row for
      // every anonymous shopper, and the guest email is optional. Two
      // guests who did not supply an email would collide, and the
      // second one's checkout would fail with a 500.
      //
      // Leaving the default undefined keeps the field genuinely absent
      // when it was not supplied, which is exactly what `sparse` needs.
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

    /**
     * Whether the customer has confirmed ownership of their email address.
     *
     * This exists so `login` can tell two very different situations
     * apart, both of which leave `isActive: false`:
     *
     *   - `emailVerified: false` → the customer registered but never
     *     entered their code. Actionable by them: "Please verify your
     *     email address first."
     *   - `emailVerified: true, isActive: false` → an admin disabled the
     *     account. Not actionable by them: "This account has been
     *     disabled."
     *
     * The default is `true` so every EXISTING account is treated as
     * verified — no one is locked out by adding this field.
     */
    emailVerified: {
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
