import { z } from 'zod';
import { BD_MOBILE_REGEX, EMAIL_REGEX } from '../user/user.constants';

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(80, 'Name is too long'),
    email: z
      .string()
      .trim()
      .regex(EMAIL_REGEX, 'Please enter a valid email address')
      .max(120)
      .transform((v) => v.toLowerCase()),
    password: z
      .string()
      .min(6, 'Password must be at least 6 characters')
      .max(120),
    phone: z
      .string()
      .trim()
      .regex(BD_MOBILE_REGEX, 'Invalid Bangladeshi mobile number (e.g. 01712345678)')
      .optional(),
    nickname: z.string().trim().max(40).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .regex(EMAIL_REGEX, 'Please enter a valid email address')
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();
