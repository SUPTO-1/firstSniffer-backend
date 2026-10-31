import mongoose, { Schema, type Model } from 'mongoose';
import type { IOtpChallenge, OtpChallengeDoc } from './otpChallenge.interface';

/**
 * Pending registration verification challenges.
 *
 * One document per email address. It carries the hashed OTP AND the
 * resend-limiter state, so the resend gate can be a single atomic
 * `findOneAndUpdate` (see `otpChallenge.service.ts`).
 */
const OtpChallengeSchema = new Schema<OtpChallengeDoc>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      index: { unique: true },
    },
    /**
     * The bcrypt hash of the OTP.
     *
     * `select: false` keeps it out of every query that does not explicitly
     * ask for it. Without this, a stray `findOne()` that gets serialised
     * into an API response or a log line would leak the hash.
     */
    otpHash: { type: String, required: true, select: false },
    otpExpiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1 },
    resendCount: { type: Number, default: 0, min: 0 },
    cooldownUntil: { type: Date, default: null },
    lastSentAt: { type: Date },
    verifiedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        // The hash must never appear in a serialised payload.
        delete ret.otpHash;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = (ret._id as { toString(): string } | undefined)?.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.otpHash;
        return ret;
      },
    },
  }
);

export const OtpChallenge: Model<OtpChallengeDoc> =
  (mongoose.models.OtpChallenge as Model<OtpChallengeDoc>) ||
  mongoose.model<OtpChallengeDoc>('OtpChallenge', OtpChallengeSchema);
