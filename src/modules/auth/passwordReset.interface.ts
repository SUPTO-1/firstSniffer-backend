import type { Types } from 'mongoose';

/**
 * A password-reset request.
 *
 * `tokenHash` and `resultingPasswordHash` are `select: false` on the
 * schema — they are only ever read through an explicit `.select('+…')`.
 */
export interface IPasswordResetToken {
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  resultingPasswordHash: string | null;
  requestedIp: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PasswordResetTokenDoc = IPasswordResetToken & {
  _id: Types.ObjectId;
};
