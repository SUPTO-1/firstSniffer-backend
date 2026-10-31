import { z } from 'zod';
import {
  addressLineEnum,
  bdAreaEnum,
  bdDistrictEnum,
  idParamSchema,
  masterListQuerySchema,
  objectId,
} from '../_shared/validation';
import { BD_MOBILE_REGEX, EMAIL_REGEX } from '../user/user.constants';

export const listCustomerQuerySchema = masterListQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
  /**
   * Filter by guest vs. registered customer. `isGuest=true` shows only
   * shoppers who checked out without an account.
   */
  isGuest: z.enum(['true', 'false']).optional(),
});

export const customerIdParamSchema = idParamSchema;

export const createCustomerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    phone: z
      .string()
      .trim()
      .regex(BD_MOBILE_REGEX, 'Invalid Bangladeshi mobile number (e.g. 01712345678)'),
    email: z
      .string()
      .trim()
      .regex(EMAIL_REGEX, 'Please enter a valid email address')
      .max(200)
      .optional(),
    address: z
      .object({
        label: z.string().trim().max(40).optional(),
        district: bdDistrictEnum,
        area: bdAreaEnum,
        address: addressLineEnum,
        isDefault: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    phone: z
      .string()
      .trim()
      .regex(BD_MOBILE_REGEX, 'Invalid Bangladeshi mobile number')
      .optional(),
    email: z
      .string()
      .trim()
      .regex(EMAIL_REGEX, 'Please enter a valid email address')
      .max(200)
      .optional(),
  })
  .strict();

export const customerActiveToggleSchema = z
  .object({ isActive: z.boolean() })
  .strict();

export const addCustomerAddressSchema = z
  .object({
    label: z.string().trim().max(40).optional(),
    district: bdDistrictEnum,
    area: bdAreaEnum,
    address: addressLineEnum,
    isDefault: z.boolean().optional(),
  })
  .strict();

export const customerAddressIdParamSchema = z
  .object({
    id: objectId,
    addressId: objectId,
  })
  .strict();
