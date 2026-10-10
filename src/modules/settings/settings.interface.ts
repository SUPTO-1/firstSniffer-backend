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
  defaultReservedBufferMl: number;
  lowStockDefaultMl: number;

  /* Orders */
  orderNumberPrefix: string;
  invoicePrefix: string;

  /* Homepage widget counts */
  featuredCount: number;
  newArrivalCount: number;
  bestSellerCount: number;

  /* Audit */
  updatedBy?: unknown;
  updatedAt?: Date;
}

export type SettingsDoc = ISettings & Document & { _id: unknown };

/**
 * Public-facing shape — used by both admin and storefront. Includes both
 * the nested groups (new in this milestone — `shipping`, `orders`,
 * `homepage`, `inventoryDefaults`) AND flat aliases of the same data
 * (e.g. `insideCtgCharge`, `orderNumberPrefix`, `defaultReservedBufferMl`)
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
    defaultReservedBufferMl: number;
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
  };

  /* ---- Flat aliases (back-compat + convenience) ---- */
  insideCtgCharge: number;
  outsideCtgCharge: number;
  freeShippingThreshold: number;
  defaultReservedBufferMl: number;
  lowStockDefaultMl: number;
  orderNumberPrefix: string;
  invoicePrefix: string;
  featuredCount: number;
  newArrivalCount: number;
  bestSellerCount: number;

  updatedBy?: string;
  updatedAt?: string;
}
