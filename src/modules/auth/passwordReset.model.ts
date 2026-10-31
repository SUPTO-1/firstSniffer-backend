import mongoose, { Schema, type Model } from 'mongoose';
import type { IPasswordResetToken, PasswordResetTokenDoc } from './passwordReset.interface';

/**
 * A password-reset request.
 *
 * WHY THIS EXISTS AS A SEPARATE COLLECTION
 * ---------------------------------------
 * The reset code is a different kind of secret from the registration OTP:
 *
 *   - It has a different lifetime (15 minutes, not 5).
 *   - It has a different purpose (it proves control of the mailbox so the
 *     customer may set a NEW password — it does not activate an account).
 *   - It must be consumable to set a password exactly once.
 *
 * Keeping it separate means the registration OTP's resend counter and
 * cooldown are never touched by a password reset, and vice versa. A
 * customer who forgets their password and also has a pending signup can
 * do both without one starving the other.
 *
 * The token is stored HASHED, exactly like the registration OTP. A leaked
 * database dump must not hand an attacker working reset links.
 */
const PasswordResetTokenSchema = new Schema<PasswordResetTokenDoc>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    /** The bcrypt hash of the reset code. The plain code is never stored. */
    tokenHash: {
      type: String,
      required: true,
      select: false,
    },

    /** When the code stops being valid. */
    expiresAt: {
      type: Date,
      required: true,
    },

    /** When the code was consumed by a successful password change. */
    usedAt: {
      type: Date,
      default: null,
    },

    /**
     * The password that was set with this code.
     *
     * Stored so that an OLD reset link cannot be replayed to roll the
     * account back to an earlier password. When a code is consumed we
     * remember the resulting hash; presenting that same code again
     * means "this is a stale link", and the request is refused.
     */
    resultingPasswordHash: {
      type: String,
      default: null,
      select: false,
    },

    /** The IP the request came from — recorded for abuse investigation. */
    requestedIp: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        // The hashes must never appear in a serialised payload.
        delete ret.tokenHash;
        delete ret.resultingPasswordHash;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.tokenHash;
        delete ret.resultingPasswordHash;
        return ret;
      },
    },
  }
);

/**
 * Expire the documents automatically.
 *
 * MongoDB's TTL monitor removes a document once `expiresAt` is in the
 * past, so a stale reset code cannot linger in the collection even if it
 * was never used. The application-level expiry check in the service is
 * still the authoritative one — TTL deletion can lag by up to a minute.
 */
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * One live request per email.
 *
 * Asking for a new code REPLACES the old one — the previous code stops
 * working immediately. This is the same "resending invalidates the
 * previous code" rule the registration OTP follows, and it is why the
 * index is UNIQUE: there can only ever be one outstanding request per
 * address, so the upsert below can never create a duplicate.
 */
PasswordResetTokenSchema.index({ email: 1 }, { unique: true });

export const PasswordResetToken: Model<PasswordResetTokenDoc> =
  (mongoose.models.PasswordResetToken as Model<PasswordResetTokenDoc>) ||
  mongoose.model<PasswordResetTokenDoc>(
    'PasswordResetToken',
    PasswordResetTokenSchema
  );
