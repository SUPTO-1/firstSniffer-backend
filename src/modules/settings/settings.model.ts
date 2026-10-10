import mongoose, { Schema, type Model } from 'mongoose';
import type { ISettings } from './settings.interface';

/**
 * Singleton settings document — one row keyed on `_id: 'global'`.
 * Holds every cross-module knob (store, contact, social, shipping,
 * inventory defaults, order prefixes, homepage widget counts) so admins
 * can tweak them from `/admin/settings` without a redeploy.
 */
const SettingsSchema = new Schema<ISettings>(
  {
    _id: { type: String, default: 'global' },

    /* ---------- Store ---------- */
    storeName: { type: String, default: 'First Sniffer', trim: true, maxlength: 120 },
    storeLogo: {
      url: { type: String, default: '', trim: true },
      fileId: { type: String, default: '', trim: true },
    },
    storeFavicon: {
      url: { type: String, default: '', trim: true },
      fileId: { type: String, default: '', trim: true },
    },

    /* ---------- Contact ---------- */
    contactEmail: { type: String, default: '', trim: true, maxlength: 200 },
    contactPhone: { type: String, default: '', trim: true, maxlength: 40 },
    contactAddress: { type: String, default: '', trim: true, maxlength: 300 },

    /* ---------- Social ---------- */
    socialFacebook: { type: String, default: '', trim: true, maxlength: 300 },
    socialInstagram: { type: String, default: '', trim: true, maxlength: 300 },
    socialTiktok: { type: String, default: '', trim: true, maxlength: 300 },
    socialYoutube: { type: String, default: '', trim: true, maxlength: 300 },

    /* ---------- Shipping ---------- */
    insideCtgCharge: { type: Number, default: 60, min: 0 },
    outsideCtgCharge: { type: Number, default: 120, min: 0 },
    freeShippingThreshold: { type: Number, default: 0, min: 0 },

    /* ---------- Inventory defaults ---------- */
    defaultReservedBufferMl: { type: Number, default: 0, min: 0 },
    lowStockDefaultMl: { type: Number, default: 30, min: 0 },

    /* ---------- Orders ---------- */
    orderNumberPrefix: {
      type: String,
      default: 'FS',
      trim: true,
      uppercase: true,
      maxlength: 12,
    },
    invoicePrefix: {
      type: String,
      default: 'INV',
      trim: true,
      uppercase: true,
      maxlength: 12,
    },

    /* ---------- Homepage widget counts ---------- */
    featuredCount: { type: Number, default: 8, min: 1, max: 50 },
    newArrivalCount: { type: Number, default: 8, min: 1, max: 50 },
    bestSellerCount: { type: Number, default: 8, min: 1, max: 50 },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: 'updatedAt' },
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

export const Settings: Model<ISettings> =
  (mongoose.models.Settings as Model<ISettings>) ||
  mongoose.model<ISettings>('Settings', SettingsSchema);
