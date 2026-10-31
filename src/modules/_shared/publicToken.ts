import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Cryptographically secure public token used for anonymous order lookup.
 *
 * WHY THIS EXISTS
 * ---------------
 * The human-readable order number (`FS-2026-000001`) is SEQUENTIAL. It is
 * a friendly reference for humans and support staff, but it is NOT a
 * secret — anyone can guess `FS-2026-000001`, `-000002`, and so on.
 *
 * The storefront's order-confirmation page fetches an order WITHOUT
 * authentication, so that endpoint must be protected by an unguessable
 * capability. Using the order number there would let anyone enumerate
 * every order in the shop (customer names, phones, addresses). This token
 * is the real capability.
 *
 * 16 bytes → 32 hex characters → 128 bits of entropy. That is far beyond
 * brute force, while still short enough to paste into a support chat.
 */
export function generatePublicToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Constant-time comparison of two public tokens.
 *
 * A plain `===` on a secret leaks timing information. `timingSafeEqual`
 * requires both buffers to be the same length, so length is checked first
 * — a length mismatch is a mismatch, not an error.
 */
export function publicTokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
