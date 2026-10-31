import type { Document } from 'mongoose';

/** ImageKit reference — pair of URL + fileId used for ImageKit cleanup. */
export interface IMediaRef {
  url: string;
  fileId: string;
}

export interface ISettings {
  _id: 'global';

  /* Store */
  storeName: string;
  storeLogo: IMediaRef;
  storeFavicon: IMediaRef;

  /* Contact */
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;

  /* Social */
  socialFacebook: string;
  socialInstagram: string;
  socialTiktok: string;
  socialYoutube: string;

  /* Shipping */
  insideCtgCharge: number;
  outsideCtgCharge: number;
  freeShippingThreshold: number;

  /* Inventory defaults */
  defaultSafetyBufferMl: number;
  lowStockDefaultMl: number;

  /* Orders */
  orderNumberPrefix: string;
  invoicePrefix: string;

  /* Homepage widget counts */
  featuredCount: number;
  newArrivalCount: number;
  bestSellerCount: number;

  /* Homepage banner (hero) */
  heroImage: IMediaRef;
  heroEyebrow: string;
  heroHeadline: string;
  heroSubheadline: string;
  heroCtaLabel: string;
  heroCtaHref: string;
  heroPriceLabel: string;
  heroPriceValue: string;

  /* Homepage discount banner */
  discountImage: IMediaRef;
  discountEnabled: boolean;
  discountCtaHref: string;
  discountEyebrow: string;
  discountHeadline: string;
  discountSubheadline: string;
  discountCtaLabel: string;

  /* Footer content */
  footerBlurb: string;

  /* Audit */
  updatedBy?: unknown;
  updatedAt?: Date;
}

export type SettingsDoc = ISettings & Document & { _id: unknown };

/**
 * Public-facing shape — used by both admin and storefront. Includes both
 * the nested groups (new in this milestone — `shipping`, `orders`,
 * `homepage`, `inventoryDefaults`) AND flat aliases of the same data
 * (e.g. `insideCtgCharge`, `orderNumberPrefix`, `defaultSafetyBufferMl`)
 * for backwards compatibility with code that referenced the pre-extension
 * schema.
 */
export interface PublicSettings {
  id: string;

  /* Store */
  storeName: string;
  storeLogo: IMediaRef;
  storeFavicon: IMediaRef;

  /* Contact */
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;

  /* Social */
  socialFacebook: string;
  socialInstagram: string;
  socialTiktok: string;
  socialYoutube: string;

  /* Shipping — nested */
  shipping: {
    insideCtgCharge: number;
    outsideCtgCharge: number;
    freeShippingThreshold: number;
  };

  /* Inventory defaults — nested */
  inventoryDefaults: {
    defaultSafetyBufferMl: number;
    lowStockDefaultMl: number;
  };

  /* Orders — nested */
  orders: {
    orderNumberPrefix: string;
    invoicePrefix: string;
  };

  /* Homepage widget counts — nested */
  homepage: {
    featuredCount: number;
    newArrivalCount: number;
    bestSellerCount: number;
    heroImage: IMediaRef;
    discountImage: IMediaRef;
    discountEnabled: boolean;
    discountCtaHref: string;
  };

  /**
   * Landing-page hero copy — nested for convenience. Mirrored flat below for
   * back-compat with consumers that read the scalar fields directly.
   */
  hero: {
    image: IMediaRef;
    eyebrow: string;
    headline: string;
    subheadline: string;
    ctaLabel: string;
    ctaHref: string;
    priceLabel: string;
    priceValue: string;
  };

  /** Landing-page discount banner copy — nested. */
  discount: {
    image: IMediaRef;
    enabled: boolean;
    ctaHref: string;
    eyebrow: string;
    headline: string;
    subheadline: string;
    ctaLabel: string;
  };

  /** Footer copy — nested. */
  footer: {
    blurb: string;
  };

  /* ---- Flat aliases (back-compat + convenience) ---- */
  insideCtgCharge: number;
  outsideCtgCharge: number;
  freeShippingThreshold: number;
  defaultSafetyBufferMl: number;
  lowStockDefaultMl: number;
  orderNumberPrefix: string;
  invoicePrefix: string;
  featuredCount: number;
  newArrivalCount: number;
  bestSellerCount: number;

  /* Homepage banners — flat aliases */
  heroImage: IMediaRef;
  discountImage: IMediaRef;
  discountEnabled: boolean;
  discountCtaHref: string;

  /* Hero / discount / footer copy — flat aliases */
  heroEyebrow: string;
  heroHeadline: string;
  heroSubheadline: string;
  heroCtaLabel: string;
  heroCtaHref: string;
  heroPriceLabel: string;
  heroPriceValue: string;
  discountEyebrow: string;
  discountHeadline: string;
  discountSubheadline: string;
  discountCtaLabel: string;
  footerBlurb: string;

  updatedBy?: string;
  updatedAt?: string;
}
