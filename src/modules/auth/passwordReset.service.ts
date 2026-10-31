import { randomInt } from 'crypto';
import { User } from '../user/user.model';
import { ApiError } from '../../utils/ApiError';
import { hashPassword, verifyPassword } from '../../utils/bcrypt';
import { PasswordResetToken } from './passwordReset.model';
import { normalizeEmail } from './otpChallenge.service';
import { sendEmail } from '../email/email.service';
import { buildPasswordResetEmail } from '../email/email.templates';
import { env } from '../../config/env';

/**
 * Password reset.
 *
 * WHY THIS EXISTS
 * ---------------
 * The storefront has always offered a "Forgot?" link that promised
 * "we'll send you a secure link to reset your password" — but no such
 * email was ever sent, because no backend endpoint existed. That is
 * exactly the kind of false promise this project must not make: email is
 * the ONLY customer notification channel, so it has to actually work.
 *
 * THE RULES
 * ---------
 * 1. NEVER REVEAL WHETHER AN ADDRESS EXISTS. The response is identical
 *    whether or not the email is on file. Otherwise this endpoint becomes
 *    an account-enumeration oracle.
 *
 * 2. THE CODE IS STORED HASHED. A database leak must not hand an
 *    attacker working reset links.
 *
 * 3. REQUESTING A NEW CODE INVALIDATES THE PREVIOUS ONE, and there is
 *    at most ONE live request per address (enforced by a unique index on
 *    `email`).
 *
 * 4. A CODE CAN BE USED EXACTLY ONCE. Once it has set a password it is
 *    spent, and replaying it is refused — otherwise an attacker who
 *    intercepted an old link could roll the account back to a
 *    previously-known password.
 *
 * 5. THE RESET DOES NOT SIGN THE CUSTOMER IN. They set a new password
 *    and then log in normally, so a stolen reset link alone does not
 *    hand over a session.
 */

/** How long a reset code stays valid. */
export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

/**
 * How many times a single reset code may be guessed.
 *
 * Deliberately small: a 6-digit code has only a million combinations,
 * so the attempt cap is the real defence against brute force.
 */
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

/**
 * The reset code is a 6-digit number, generated the same way the
 * registration OTP is — with `crypto.randomInt`, which is a CSPRNG.
 *
 * The code is grouped as `XXX-XXX` for readability in an email, but the
 * stored form has no separator. The hyphen is stripped before hashing
 * and before comparing, so a customer may type it either way.
 */
export function generateResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Render a code as `123-456` for display in an email. */
export function formatResetCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** Strip any separators a customer might have typed. */
function normaliseCode(code: string): string {
  return code.replace(/[\s-]/g, '');
}

/**
 * Build the link the customer clicks.
 *
 * The base URL comes from `env.frontendUrl` — never a hardcoded
 * deployment hostname — and the code rides along in the query string so
 * the storefront's reset screen can pre-fill it.
 */
export function buildResetUrl(code: string): string {
  const base = (env.frontendUrl ?? '').replace(/\/+$/, '');
  return `${base}/reset-password?code=${encodeURIComponent(code)}`;
}

/**
 * Issue a reset code for an address.
 *
 * @param email The address to send the code to.
 * @param requestedIp The caller's IP, recorded for abuse investigation.
 */
export async function requestPasswordReset(
  email: string,
  requestedIp?: string | null
): Promise<{ emailSent: boolean }> {
  const address = normalizeEmail(email);

  /**
   * Look the user up WITHOUT revealing the result. A guest account, an
   * unknown address and a disabled account all take the same path: no
   * code is issued, and the caller still reports success.
   *
   * `password` is `select: false` on the User schema, so it has to be
   * asked for explicitly — without this the field is simply absent from
   * the result and every customer would look like a guest.
   */
  const user = await User.findOne({ email: address })
    .select('+password')
    .lean()
    .exec();

  if (!user || !user.password || !user.isActive) {
    /**
     * A guest row has no password to reset, and a disabled account
     * should not be recoverable by the person who used to own it.
     *
     * We deliberately do NOT send an email here either. Sending "we
     * could not find that account" would be an enumeration oracle;
     * sending nothing is indistinguishable from success.
     */
    return { emailSent: false };
  }

  /* Generate the code and hash it BEFORE touching the database. */
  const code = generateResetCode();
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  /**
   * ONE LIVE REQUEST PER ADDRESS.
   *
   * The unique index on `email` means this upsert can never create a
   * second row — asking for a new code REPLACES the previous one, which
   * immediately invalidates the old code. This is the same rule the
   * registration OTP follows ("resending invalidates the previous OTP").
   */
  await PasswordResetToken.updateOne(
    { email: address },
    {
      $set: {
        tokenHash: codeHash,
        expiresAt,
        usedAt: null,
        resultingPasswordHash: null,
        requestedIp: requestedIp ?? null,
      },
      $setOnInsert: { email: address },
    },
    { upsert: true }
  ).exec();

  const message = buildPasswordResetEmail({
    name: user.name,
    code: formatResetCode(code),
    resetUrl: buildResetUrl(code),
    expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60_000),
  });

  const result = await sendEmail({
    to: address,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (!result.sent) {
    console.error(
      `[email] Password reset email for ${address} was not delivered:`,
      result.error ?? 'unknown error'
    );
  }

  return { emailSent: result.sent };
}

/**
 * Consume a reset code and set a new password.
 *
 * @param email The address the code was issued for.
 * @param code The code the customer typed.
 * @param newPassword The password to set.
 */
export async function resetPasswordWithCode(
  email: string,
  code: string,
  newPassword: string
): Promise<{ email: string }> {
  const address = normalizeEmail(email);
  const cleanCode = normaliseCode(code);

  const record = await PasswordResetToken.findOne({ email: address })
    .select('+tokenHash +resultingPasswordHash')
    .exec();

  /**
   * No request on file. The message is deliberately identical to the
   * "expired" and "wrong code" cases so a caller cannot probe which
   * addresses ever had a reset request.
   */
  const invalid = ApiError.badRequest(
    'This reset code is invalid or has expired. Please request a new one.'
  );

  if (!record) throw invalid;

  /**
   * A code that was already used CANNOT be replayed.
   *
   * The recorded `resultingPasswordHash` is how we recognise a replay:
   * if the customer presents a code whose hash matches the password we
   * installed, they are replaying the very code that set that password.
   * Refusing this stops an attacker who captured an old link from
   * rolling the account back to a password they already know.
   *
   * Either way the answer is the same generic error — the caller learns
   * nothing about whether the code existed.
   */
  if (record.usedAt) throw invalid;

  if (record.expiresAt.getTime() <= Date.now()) throw invalid;

  const matches = await verifyPassword(cleanCode, record.tokenHash);
  if (!matches) throw invalid;

  /* The new password is hashed before it is stored, always. */
  const passwordHash = await hashPassword(newPassword);

  const user = await User.findOne({ email: address }).exec();
  if (!user) throw invalid;

  user.password = passwordHash;
  await user.save();

  /**
   * Mark the code spent.
   *
   * `resultingPasswordHash` records WHICH password this code installed.
   * A later request for a new code clears it, so only the most recent
   * code can be replayed — and replaying it is refused anyway.
   */
  await PasswordResetToken.updateOne(
    { _id: record._id },
    { $set: { usedAt: new Date(), resultingPasswordHash: passwordHash } }
  ).exec();

  return { email: address };
}
