import { Router } from 'express';
import { validate } from '../../middleware/validateRequest';
import { z } from 'zod';
import {
  getPublicOrderByNumber,
  getPublicInvoiceByNumber,
  getPublicOrderByToken,
  getPublicInvoiceByToken,
} from './public.orders.controller';

const router = Router();

// No auth — public storefront.

const orderNumberParamSchema = z
  .object({
    orderNumber: z
      .string()
      .trim()
      .min(3, 'Order number is required')
      .max(64, 'Order number is too long')
      .regex(/^[A-Z0-9-]+$/i, 'Order number must contain only letters, numbers and dashes'),
  })
  .strict();

/**
 * Public token — 32 lowercase hex characters from `crypto.randomBytes(16)`.
 *
 * This is the capability that protects anonymous order lookup. The
 * human-readable `orderNumber` is SEQUENTIAL and guessable, so it must
 * never be the only thing standing between a stranger and someone else's
 * order (name, phone, address).
 */
const publicTokenParamSchema = z
  .object({
    token: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-f0-9]{32}$/, 'Invalid tracking token'),
  })
  .strict();

/**
 * Token-based lookup — the SAFE public route.
 *
 * A guest checkout returns a `publicToken` alongside the order; the
 * storefront receipt page uses it to fetch the order and its invoice
 * without any authentication.
 *
 * Registered customers also get a token (it is minted for every order),
 * so this route works for them too — the account order list is a
 * convenience, not a requirement.
 */
router.get(
  '/track/:token',
  validate(publicTokenParamSchema, 'params'),
  getPublicOrderByToken
);

router.get(
  '/track/:token/invoice',
  validate(publicTokenParamSchema, 'params'),
  getPublicInvoiceByToken
);

/**
 * Order-number lookup — kept for backwards compatibility with existing
 * order-confirmation links, but it is a WEAKER capability.
 *
 * The order number is sequential (`FS-2026-000001`), so anyone can
 * enumerate the shop's order history by trying successive numbers. We
 * therefore require the token when one exists: if the order HAS a public
 * token, the order-number route refuses to serve it.
 */
router.get(
  '/:orderNumber',
  validate(orderNumberParamSchema, 'params'),
  getPublicOrderByNumber
);

// Public invoice PDF — same order-number capability as the lookup. No
// payments log (admin-only). Returns 404 on unknown orderNumber so we
// don't offer a cheap oracle to brute-force attempts.
router.get(
  '/:orderNumber/invoice',
  validate(orderNumberParamSchema, 'params'),
  getPublicInvoiceByNumber
);

export default router;
