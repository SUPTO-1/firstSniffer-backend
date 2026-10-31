import type { Document } from 'mongoose';

/**
 * A pending registration verification challenge.
 *
 * ONE document per email address holds BOTH the OTP itself and the resend
 * limiter state. Keeping them together is what makes the resend gate a
 * single atomic MongoDB operation — see `otpChallenge.service.ts`.
 */
export interface IOtpChallenge {
  /** The address being verified. Always stored lowercase. */
  email: string;
  /**
   * The bcrypt hash of the 6-digit code.
   *
   * The plain code is NEVER stored, never logged, and never returned by
   * the API. `select: false` on the schema path means it is excluded from
   * ordinary queries too, so it cannot leak through an accidental
   * `find()` that gets serialised to JSON.
   */
  otpHash: string;
  /** When the current code stops being valid. */
  otpExpiresAt: Date;
  /** How many verification attempts have been spent on the current code. */
  attempts: number;
  /** The ceiling on `attempts` for the current code. */
  maxAttempts: number;
  /**
   * How many EXPLICIT resend requests have been used in the current
   * window.
   *
   * The INITIAL OTP does NOT count — only `POST /auth/resend-otp`
   * increments this. Registration retries never touch it, so replaying
   * the signup form cannot buy extra resends.
   */
  resendCount: number;
  /**
   * When the resend button is blocked until.
   *
   * Armed in the SAME atomic write that performs the third resend, so
   * there is never a moment where the limit is reached but the cooldown
   * is not yet set.
   */
  cooldownUntil?: Date | null;
  /** When the most recent code was sent (initial or resend). */
  lastSentAt?: Date;
  /** Set once the code has been successfully used. */
  verifiedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OtpChallengeDoc = IOtpChallenge & Document & { _id: unknown };
