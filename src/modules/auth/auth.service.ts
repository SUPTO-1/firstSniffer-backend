import { User } from '../user/user.model';
import { toPublicUser } from '../user/user.service';
import { ApiError } from '../../utils/ApiError';
import { hashPassword, verifyPassword } from '../../utils/bcrypt';
import { signToken } from '../../utils/jwt';
import { sendEmail } from '../email/email.service';
import { buildOtpEmail } from '../email/email.templates';
import {
  issueInitialOtp,
  markOtpVerified,
  normalizeEmail,
  resendOtp,
  verifyOtp,
  OTP_COOLDOWN_MS,
  OTP_MAX_RESENDS,
  OTP_TTL_MS,
} from './otpChallenge.service';
import type {
  AuthResult,
  LoginInput,
  RegisterInput,
  RegisterResult,
  ResendOtpResult,
} from './auth.interface';
import type { PublicUser, UserDoc } from '../user/user.interface';

function buildAuthResult(doc: UserDoc): AuthResult {
  const u = toPublicUser(doc);
  const token = signToken({
    sub: u.id,
    email: u.email ?? undefined,
    role: u.role,
  });
  return {
    token,
    user: {
      id: u.id,
      name: u.name,
      email: u.email ?? null,
      phone: u.phone ?? null,
      role: u.role,
      nickname: u.nickname ?? null,
      joinedAt: u.joinedAt,
      createdAt: doc.createdAt,
    },
  };
}

/**
 * Register a new customer.
 *
 * The account is created INACTIVE and a verification code is emailed. No
 * JWT is issued here — the customer must verify their address first, at
 * which point `verifyOtpAndActivate` returns the token.
 *
 * Re-registering an address that already has a PENDING account reuses
 * that account and sends a fresh code rather than failing with a
 * conflict — a customer who mistyped their email and came back should not
 * be locked out. It does NOT reset the resend limiter: `issueInitialOtp`
 * deliberately leaves `resendCount` and `cooldownUntil` untouched.
 */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const existing = await User.findOne({ email }).lean();

  if (existing) {
    /**
     * An already-VERIFIED account keeps the original conflict error —
     * that is a real duplicate, not a pending signup.
     */
    const isVerified = (existing as { emailVerified?: boolean }).emailVerified !== false;
    if (isVerified || (existing as { isActive?: boolean }).isActive) {
      throw ApiError.conflict('An account with this email already exists');
    }

    /* A pending account: refresh the code and let them verify. */
    const { otp, expiresAt } = await issueInitialOtp(email);
    const sent = await sendOtpEmail(existing.name, email, otp);

    return {
      verificationRequired: true,
      email,
      expiresAt,
      emailSent: sent,
    };
  }

  const passwordHash = await hashPassword(input.password);

  const doc = await User.create({
    name: input.name,
    nickname: input.nickname ?? null,
    email,
    phone: input.phone ?? null,
    password: passwordHash,
    role: 'customer',
    isGuest: false,
    /**
     * The account starts inactive. `emailVerified: false` is what lets
     * `login` tell "not verified yet" apart from "admin disabled this
     * account" and show the right message.
     */
    isActive: false,
    emailVerified: false,
    addresses: [],
  });

  const { otp, expiresAt } = await issueInitialOtp(email);
  const sent = await sendOtpEmail(input.name, email, otp);

  return {
    verificationRequired: true,
    email,
    expiresAt,
    emailSent: sent,
  };
}

/**
 * Send the OTP email.
 *
 * The plain code is passed straight into the template and is never
 * logged or stored. A delivery failure is reported back to the caller
 * (`emailSent: false`) rather than thrown, so the account still exists
 * and the customer can retry.
 */
async function sendOtpEmail(
  name: string,
  email: string,
  otp: string
): Promise<boolean> {
  const message = buildOtpEmail({
    name,
    otp,
    expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
  });
  const result = await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  return result.sent;
}

/**
 * Verify the OTP and activate the account.
 *
 * On success the account is flipped to active+verified, the challenge is
 * invalidated, and the caller receives a JWT.
 */
export async function verifyOtpAndActivate(
  email: string,
  otp: string
): Promise<AuthResult> {
  const address = normalizeEmail(email);
  const challenge = await verifyOtp(address, otp);

  const user = await User.findOne({ email: address }).exec();
  if (!user) {
    throw ApiError.notFound('Account not found');
  }

  if (!user.emailVerified) {
    user.emailVerified = true;
    user.isActive = true;
    await user.save();
  }

  await markOtpVerified(address);

  return buildAuthResult(user as unknown as UserDoc);
}

/**
 * Resend the verification code.
 *
 * The 3-resend / 30-minute-cooldown policy is enforced inside
 * `resendOtp` by a single atomic MongoDB operation, so concurrent
 * requests cannot bypass it.
 */
export async function resendOtpForUser(
  input: { email: string; name?: string }
): Promise<ResendOtpResult> {
  const address = normalizeEmail(input.email);

  const user = await User.findOne({ email: address }).lean();

  /**
   * We deliberately do NOT reveal whether the address exists — that would
   * turn this endpoint into an account-enumeration oracle. The response
   * is the same shape either way.
   */
  if (!user) {
    throw ApiError.badRequest(
      'No pending registration was found for this email address'
    );
  }

  /* Generate the new code BEFORE taking the lock, so the hashing cost is
   * not paid while holding the document. */
  const { generateOtp } = await import('./otpChallenge.service');
  const otp = generateOtp();
  const otpHash = await hashPassword(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const outcome = await resendOtp(address, otpHash, expiresAt);

  if (!outcome.ok) {
    /**
     * The customer is inside the cooldown. The controller turns this into
     * a 429 with a `Retry-After` header.
     */
    throw ApiError.tooManyRequests(
      `You have reached the maximum number of code requests. Please try again in ${Math.ceil(outcome.retryAfterSeconds / 60)} minute(s).`
    );
  }

  const sent = await sendOtpEmail(
    (user as { name?: string }).name ?? 'there',
    address,
    otp
  );

  return {
    verificationRequired: true,
    email: address,
    expiresAt,
    emailSent: sent,
    resendsRemaining: Math.max(
      0,
      OTP_MAX_RESENDS - (outcome.challenge.resendCount ?? 0)
    ),
  };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const doc = await User.findOne({ email: normalizeEmail(input.email) }).select(
    '+password'
  );
  // Generic error — never reveal whether email exists.
  const invalid = ApiError.unauthorized('Invalid email or password');

  if (!doc) throw invalid;
  if (!doc.password) throw invalid;

  if (!doc.isActive) {
    /**
     * Distinguish "never verified your email" from "admin disabled this
     * account". Both are inactive, but only one of them is fixable by the
     * customer themselves.
     */
    if (doc.emailVerified === false) {
      throw ApiError.forbidden('Please verify your email address first.');
    }
    throw ApiError.forbidden('This account has been disabled');
  }

  const ok = await verifyPassword(input.password, doc.password);
  if (!ok) throw invalid;

  return buildAuthResult(doc);
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const doc = await User.findById(userId);
  return toPublicUser(doc);
}
