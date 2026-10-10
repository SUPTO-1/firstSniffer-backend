import { z } from 'zod';
import { BD_MOBILE_REGEX } from './user.constants';

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(80, 'Name is too long')
      .optional(),
    nickname: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional(),
    phone: z
      .string()
      .trim()
      .regex(BD_MOBILE_REGEX, 'Invalid Bangladeshi mobile number (e.g. 01712345678)')
      .nullable()
      .optional(),
  })
  .strict();

export const addAddressSchema = z
  .object({
    label: z.string().trim().max(40).optional(),
    district: z.string().trim().min(1, 'District is required').max(80),
    area: z.string().trim().min(1, 'Area is required').max(120),
    address: z.string().trim().min(1, 'Address is required').max(300),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const updateAddressSchema = z
  .object({
    label: z.string().trim().max(40).optional(),
    district: z.string().trim().min(1).max(80).optional(),
    area: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().min(1).max(300).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const addressIdParamSchema = z
  .object({
    addressId: objectId,
  })
  .strict();
