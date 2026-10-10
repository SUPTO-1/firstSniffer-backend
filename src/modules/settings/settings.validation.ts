import { z } from 'zod';

/** Optional URL — accepts empty string OR a valid URL. Used by ImageKit URLs. */
const optionalUrl = z
  .union([z.literal(''), z.string().trim().url('Must be a valid URL')])
  .optional();

const optionalString = z.string().trim().max(300).optional();

/** Uppercased 1-12 char prefix used in order numbers and invoice numbers. */
const prefixLike = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(12)
  .regex(/^[A-Z0-9-]+$/, 'Use uppercase letters, numbers, dashes only');

export const updateSettingsSchema = z
  .object({
    /* Store */
    storeName: z.string().trim().min(1).max(120).optional(),
    storeLogo: z
      .object({
        url: optionalUrl,
        fileId: z.string().trim().max(128).optional(),
      })
      .strict()
      .optional(),
    storeFavicon: z
      .object({
        url: optionalUrl,
        fileId: z.string().trim().max(128).optional(),
      })
      .strict()
      .optional(),

    /* Contact */
    contactEmail: z.string().trim().max(200).optional(),
    contactPhone: z.string().trim().max(40).optional(),
    contactAddress: z.string().trim().max(300).optional(),

    /* Social */
    socialFacebook: optionalString,
    socialInstagram: optionalString,
    socialTiktok: optionalString,
    socialYoutube: optionalString,

    /* Shipping */
    insideCtgCharge: z.coerce.number().min(0).optional(),
    outsideCtgCharge: z.coerce.number().min(0).optional(),
    freeShippingThreshold: z.coerce.number().min(0).optional(),

    /* Inventory defaults */
    defaultReservedBufferMl: z.coerce.number().min(0).optional(),
    lowStockDefaultMl: z.coerce.number().min(0).optional(),

    /* Orders */
    orderNumberPrefix: prefixLike.optional(),
    invoicePrefix: prefixLike.optional(),

    /* Homepage widget counts */
    featuredCount: z.coerce.number().int().min(1).max(50).optional(),
    newArrivalCount: z.coerce.number().int().min(1).max(50).optional(),
    bestSellerCount: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
