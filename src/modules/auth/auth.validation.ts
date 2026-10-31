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

/**
 * Verify a registration code.
 *
 * The code must be EXACTLY six digits — no more, no fewer. The leading
 * zeros matter (a code can legitimately be `004271`), so the schema keeps
 * it as a string and never coerces it to a number.
 */
export const verifyOtpSchema = z
  .object({
    email: z
      .string()
      .trim()
      .regex(EMAIL_REGEX, 'Please enter a valid email address')
      .transform((v) => v.toLowerCase()),
    otp: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Please enter the 6-digit verification code'),
  })
  .strict();

/**
 * Request a new registration code.
 *
 * Only the email address is accepted. The customer never supplies a
 * percentage, an attempt count, or anything else about the limiter — the
 * server owns all of it.
 */
export const resendOtpSchema = z
  .object({
    email: z
      .string()
      .trim()
      .regex(EMAIL_REGEX, 'Please enter a valid email address')
      .transform((v) => v.toLowerCase()),
  })
  .strict();

/**
 * Ask for a password-reset code.
 *
 * Only the address is accepted. The server decides whether a code is
 * issued, and the response is identical either way so this endpoint can
 * never be used to discover which addresses have accounts.
 */
export const forgotPasswordSchema = z
  .object({
    email: z
      .string()
      .trim()
      .regex(EMAIL_REGEX, 'Please enter a valid email address')
      .transform((v) => v.toLowerCase()),
  })
  .strict();

/**
 * Set a new password with a reset code.
 *
 * The code is exactly six digits. It is kept as a string — never
 * coerced to a number — so the leading zeros survive ("004271" is a
 * legitimate code).
 *
 * The customer may type the code with or without the hyphen the email
 * groups it with ("123-456" or "123456"). The separator is stripped
 * before the code is hashed and compared, so both forms work.
 */
export const resetPasswordSchema = z
  .object({
    email: z
      .string()
      .trim()
      .regex(EMAIL_REGEX, 'Please enter a valid email address')
      .transform((v) => v.toLowerCase()),
    code: z
      .string()
      .trim()
      .regex(/^\d{3}-?\d{3}$/, 'Please enter the 6-digit reset code'),
    password: z
      .string()
      .min(6, 'Password must be at least 6 characters')
      .max(120),
  })
  .strict();
