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
    defaultSafetyBufferMl: { type: Number, default: 0, min: 0 },
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

    /* ---------- Homepage banner (hero) ---------- */
    heroImage: {
      url: { type: String, default: '', trim: true },
      fileId: { type: String, default: '', trim: true },
    },
    // Hero copy is admin-editable so the landing page can be re-art-directed
    // (campaign, seasonal offer, new positioning) without a redeploy. The
    // defaults below are the art-directed launch copy — leaving the CMS
    // fields empty is never a valid state.
    heroEyebrow: {
      type: String,
      default: 'Authentic Luxury Decants',
      trim: true,
      maxlength: 80,
    },
    heroHeadline: {
      type: String,
      default: 'The Art of Scent, Decanted.',
      trim: true,
      maxlength: 120,
    },
    heroSubheadline: {
      type: String,
      default:
        'Experience the world’s finest fragrances in considered sizes. Authentic decants, meticulously sourced and beautifully presented.',
      trim: true,
      maxlength: 400,
    },
    heroCtaLabel: {
      type: String,
      default: 'Shop the Collection',
      trim: true,
      maxlength: 40,
    },
    heroCtaHref: { type: String, default: '/', trim: true, maxlength: 500 },
    heroPriceLabel: {
      type: String,
      default: 'Decants from',
      trim: true,
      maxlength: 40,
    },
    heroPriceValue: {
      type: String,
      default: '৳2,200',
      trim: true,
      maxlength: 24,
    },

    /* ---------- Homepage discount banner ---------- */
    discountImage: {
      url: { type: String, default: '', trim: true },
      fileId: { type: String, default: '', trim: true },
    },
    discountEnabled: { type: Boolean, default: true },
    discountCtaHref: { type: String, default: '/', trim: true, maxlength: 500 },
    discountEyebrow: {
      type: String,
      default: 'Limited Time Only',
      trim: true,
      maxlength: 80,
    },
    discountHeadline: {
      type: String,
      default: 'Up to 20% Off Selected Decants',
      trim: true,
      maxlength: 120,
    },
    discountSubheadline: {
      type: String,
      default:
        'Discover premium fragrances at a rare reduction. Same authenticity. More to explore.',
      trim: true,
      maxlength: 400,
    },
    discountCtaLabel: {
      type: String,
      default: 'Shop the Offer',
      trim: true,
      maxlength: 40,
    },

    /* ---------- Footer content ---------- */
    footerBlurb: {
      type: String,
      default:
        'Authentic luxury perfume decants. Bangladesh’s favourite destination for genuine, hand-filled fragrances in considered sizes.',
      trim: true,
      maxlength: 400,
    },

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
