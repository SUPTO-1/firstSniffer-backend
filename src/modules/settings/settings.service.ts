import { Settings } from './settings.model';
import { ApiError } from '../../utils/ApiError';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import type { PublicSettings, IMediaRef } from './settings.interface';

/* ------------------------------------------------------------------
 *  Whitelist of writable scalar keys (top-level only).
 *  Nested image refs are picked explicitly below.
 * ------------------------------------------------------------------ */
const WRITABLE_SETTINGS_KEYS = [
  'storeName',
  'contactEmail',
  'contactPhone',
  'contactAddress',
  'socialFacebook',
  'socialInstagram',
  'socialTiktok',
  'socialYoutube',
  'insideCtgCharge',
  'outsideCtgCharge',
  'freeShippingThreshold',
  'defaultReservedBufferMl',
  'lowStockDefaultMl',
  'orderNumberPrefix',
  'invoicePrefix',
  'featuredCount',
  'newArrivalCount',
  'bestSellerCount',
  'discountEnabled',
  'discountCtaHref',
  'discountEyebrow',
  'discountHeadline',
  'discountSubheadline',
  'discountCtaLabel',
  'heroEyebrow',
  'heroHeadline',
  'heroSubheadline',
  'heroCtaLabel',
  'heroCtaHref',
  'heroPriceLabel',
  'heroPriceValue',
  'footerBlurb',
] as const;

/* ------------------------------------------------------------------
 *  Serialisation — flattens nested fields into the public shape so
 *  the storefront doesn't need to know the storage layout.
 * ------------------------------------------------------------------ */
function toMediaRef(value: unknown): IMediaRef {
  const v = (value as Partial<IMediaRef> | undefined) ?? {};
  return {
    url: v.url ?? '',
    fileId: v.fileId ?? '',
  };
}

export function toPublicSettings(doc: unknown): PublicSettings {
  const raw = doc as Record<string, unknown> & {
    updatedBy?: { toString(): string } | string;
    updatedAt?: Date;
  };
  const insideCtgCharge = (raw.insideCtgCharge as number) ?? 60;
  const outsideCtgCharge = (raw.outsideCtgCharge as number) ?? 120;
  const freeShippingThreshold = (raw.freeShippingThreshold as number) ?? 0;
  const defaultReservedBufferMl = (raw.defaultReservedBufferMl as number) ?? 0;
  const lowStockDefaultMl = (raw.lowStockDefaultMl as number) ?? 30;
  const orderNumberPrefix = (raw.orderNumberPrefix as string) ?? 'FS';
  const invoicePrefix = (raw.invoicePrefix as string) ?? 'INV';
  const featuredCount = (raw.featuredCount as number) ?? 8;
  const newArrivalCount = (raw.newArrivalCount as number) ?? 8;
  const bestSellerCount = (raw.bestSellerCount as number) ?? 8;
  const heroImage = toMediaRef(raw.heroImage);
  const discountImage = toMediaRef(raw.discountImage);
  const discountEnabled = (raw.discountEnabled as boolean) ?? true;
  const discountCtaHref =
    (raw.discountCtaHref as string)?.trim() || '/';

  /* ----- Landing-page copy (CMS-managed). Trimmed with hard fallbacks so a
   * blank string in the DB can never render an empty hero. ----- */
  const heroEyebrow =
    (raw.heroEyebrow as string)?.trim() || 'Authentic Luxury Decants';
  const heroHeadline =
    (raw.heroHeadline as string)?.trim() || 'The Art of Scent, Decanted.';
  const heroSubheadline =
    (raw.heroSubheadline as string)?.trim() ||
    'Experience the world’s finest fragrances in considered sizes. Authentic decants, meticulously sourced and beautifully presented.';
  const heroCtaLabel =
    (raw.heroCtaLabel as string)?.trim() || 'Shop the Collection';
  const heroCtaHref = (raw.heroCtaHref as string)?.trim() || '/';
  const heroPriceLabel =
    (raw.heroPriceLabel as string)?.trim() || 'Decants from';
  const heroPriceValue = (raw.heroPriceValue as string)?.trim() || '৳2,200';

  const discountEyebrow =
    (raw.discountEyebrow as string)?.trim() || 'Limited Time Only';
  const discountHeadline =
    (raw.discountHeadline as string)?.trim() ||
    'Up to 20% Off Selected Decants';
  const discountSubheadline =
    (raw.discountSubheadline as string)?.trim() ||
    'Discover premium fragrances at a rare reduction. Same authenticity. More to explore.';
  const discountCtaLabel =
    (raw.discountCtaLabel as string)?.trim() || 'Shop the Offer';

  const footerBlurb =
    (raw.footerBlurb as string)?.trim() ||
    'Authentic luxury perfume decants. Bangladesh’s favourite destination for genuine, hand-filled fragrances in considered sizes.';

  return {
    id: raw._id ? String(raw._id) : 'global',
    storeName: (raw.storeName as string) ?? 'First Sniffer',
    storeLogo: toMediaRef(raw.storeLogo),
    storeFavicon: toMediaRef(raw.storeFavicon),
    contactEmail: (raw.contactEmail as string) ?? '',
    contactPhone: (raw.contactPhone as string) ?? '',
    contactAddress: (raw.contactAddress as string) ?? '',
    socialFacebook: (raw.socialFacebook as string) ?? '',
    socialInstagram: (raw.socialInstagram as string) ?? '',
    socialTiktok: (raw.socialTiktok as string) ?? '',
    socialYoutube: (raw.socialYoutube as string) ?? '',
    shipping: {
      insideCtgCharge,
      outsideCtgCharge,
      freeShippingThreshold,
    },
    inventoryDefaults: {
      defaultReservedBufferMl,
      lowStockDefaultMl,
    },
    orders: {
      orderNumberPrefix,
      invoicePrefix,
    },
    homepage: {
      featuredCount,
      newArrivalCount,
      bestSellerCount,
      heroImage,
      discountImage,
      discountEnabled,
      discountCtaHref,
    },
    hero: {
      image: heroImage,
      eyebrow: heroEyebrow,
      headline: heroHeadline,
      subheadline: heroSubheadline,
      ctaLabel: heroCtaLabel,
      ctaHref: heroCtaHref,
      priceLabel: heroPriceLabel,
      priceValue: heroPriceValue,
    },
    discount: {
      image: discountImage,
      enabled: discountEnabled,
      ctaHref: discountCtaHref,
      eyebrow: discountEyebrow,
      headline: discountHeadline,
      subheadline: discountSubheadline,
      ctaLabel: discountCtaLabel,
    },
    footer: {
      blurb: footerBlurb,
    },
    /* flat aliases (back-compat) */
    insideCtgCharge,
    outsideCtgCharge,
    freeShippingThreshold,
    defaultReservedBufferMl,
    lowStockDefaultMl,
    orderNumberPrefix,
    invoicePrefix,
    featuredCount,
    newArrivalCount,
    bestSellerCount,
    heroImage,
    discountImage,
    discountEnabled,
    discountCtaHref,
    heroEyebrow,
    heroHeadline,
    heroSubheadline,
    heroCtaLabel,
    heroCtaHref,
    heroPriceLabel,
    heroPriceValue,
    discountEyebrow,
    discountHeadline,
    discountSubheadline,
    discountCtaLabel,
    footerBlurb,
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : undefined,
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

/**
 * Returns the singleton settings doc, creating it with defaults on first
 * call. Always succeeds — never throws on missing row.
 */
export async function getSettings(): Promise<PublicSettings> {
  let doc = await Settings.findById('global');
  if (!doc) {
    doc = await Settings.create({ _id: 'global' });
  }
  return toPublicSettings(doc);
}

/**
 * Updates the singleton. Uses `pickWritable` so unknown keys are dropped.
 * For nested image refs (`storeLogo` / `storeFavicon`) we compare the
 * incoming `fileId` to the existing one and fire-and-forget delete the
 * old ImageKit file when it changes.
 */
export async function updateSettings(
  input: Record<string, unknown>,
  actorId?: string
): Promise<PublicSettings> {
  // Ensure the row exists so findOneAndUpdate can target it.
  await getSettings();

  const existing = await Settings.findById('global');
  if (!existing) throw ApiError.notFound('Settings not found');

  const set: Record<string, unknown> = pickWritable(
    input,
    WRITABLE_SETTINGS_KEYS
  );

  /* ----- Nested image refs ----- */
  if (input.storeLogo && typeof input.storeLogo === 'object') {
    const incoming = input.storeLogo as IMediaRef;
    const oldFileId = (existing.storeLogo as IMediaRef | undefined)?.fileId;
    set.storeLogo = {
      url: incoming.url ?? (existing.storeLogo as IMediaRef)?.url ?? '',
      fileId:
        incoming.fileId ?? (existing.storeLogo as IMediaRef)?.fileId ?? '',
    };
    if (oldFileId && incoming.fileId && oldFileId !== incoming.fileId) {
      void deleteImageKitFile(oldFileId);
    }
  }
  if (input.storeFavicon && typeof input.storeFavicon === 'object') {
    const incoming = input.storeFavicon as IMediaRef;
    const oldFileId = (existing.storeFavicon as IMediaRef | undefined)?.fileId;
    set.storeFavicon = {
      url: incoming.url ?? (existing.storeFavicon as IMediaRef)?.url ?? '',
      fileId:
        incoming.fileId ?? (existing.storeFavicon as IMediaRef)?.fileId ?? '',
    };
    if (oldFileId && incoming.fileId && oldFileId !== incoming.fileId) {
      void deleteImageKitFile(oldFileId);
    }
  }

  /* ----- Homepage banner image refs ----- */
  if (input.heroImage && typeof input.heroImage === 'object') {
    const incoming = input.heroImage as IMediaRef;
    const oldFileId = (existing.heroImage as IMediaRef | undefined)?.fileId;
    set.heroImage = {
      url: incoming.url ?? (existing.heroImage as IMediaRef)?.url ?? '',
      fileId:
        incoming.fileId ?? (existing.heroImage as IMediaRef)?.fileId ?? '',
    };
    if (oldFileId && incoming.fileId && oldFileId !== incoming.fileId) {
      void deleteImageKitFile(oldFileId);
    }
  }
  if (input.discountImage && typeof input.discountImage === 'object') {
    const incoming = input.discountImage as IMediaRef;
    const oldFileId = (existing.discountImage as IMediaRef | undefined)?.fileId;
    set.discountImage = {
      url: incoming.url ?? (existing.discountImage as IMediaRef)?.url ?? '',
      fileId:
        incoming.fileId ?? (existing.discountImage as IMediaRef)?.fileId ?? '',
    };
    if (oldFileId && incoming.fileId && oldFileId !== incoming.fileId) {
      void deleteImageKitFile(oldFileId);
    }
  }

  if (actorId) set.updatedBy = actorId;
  if (Object.keys(set).length === 0) {
    return toPublicSettings(existing);
  }

  const doc = await Settings.findOneAndUpdate(
    { _id: 'global' },
    { $set: set },
    { new: true, runValidators: true }
  );
  if (!doc) throw ApiError.notFound('Settings not found');
  return toPublicSettings(doc);
}
