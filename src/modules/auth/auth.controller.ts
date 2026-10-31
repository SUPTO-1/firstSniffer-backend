import type { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as service from './auth.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { clearAuthCookie, setAuthCookie } from '../../config/cookie';
import { ApiError } from '../../utils/ApiError';
import { getResendState } from './otpChallenge.service';
import * as passwordResetService from './passwordReset.service';

/**
 * Register a new customer.
 *
 * No auth cookie is set here: the account is inactive until the email
 * address is verified. The response tells the client that verification
 * is required so it can move the customer to the code-entry step.
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.register(req.body);
  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Verification code sent. Please check your email.',
    data: {
      verificationRequired: true,
      email: result.email,
      expiresAt: result.expiresAt,
      emailSent: result.emailSent,
    },
  });
});

/**
 * Verify the registration code and sign the customer in.
 *
 * This is where the JWT is finally issued and the auth cookie is set.
 */
export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.verifyOtpAndActivate(req.body.email, req.body.otp);
  setAuthCookie(res, result.token);
  return sendResponse(res, {
    message: 'Email verified. Welcome!',
    data: result.user,
  });
});

/**
 * Resend the registration code.
 *
 * The 3-resend / 30-minute cooldown is enforced server-side in
 * `otpChallenge.service`. When the customer is blocked we return 429 with
 * a `Retry-After` header so any client (and the storefront's live
 * countdown) knows exactly how long is left.
 */
export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await service.resendOtpForUser(req.body);
    return sendResponse(res, {
      message: 'A new verification code has been sent to your email.',
      data: {
        verificationRequired: true,
        email: result.email,
        expiresAt: result.expiresAt,
        emailSent: result.emailSent,
        resendsRemaining: result.resendsRemaining,
      },
    });
  } catch (err) {
    /**
     * The service signals a cooldown with a 429 ApiError. We enrich it
     * with the exact `Retry-After` so the client can count down.
     */
    if (err instanceof ApiError && err.statusCode === httpStatus.TOO_MANY_REQUESTS) {
      const state = await getResendState(req.body.email);
      const now = Date.now();
      const remainingMs =
        state.cooldownUntil && state.cooldownUntil.getTime() > now
          ? state.cooldownUntil.getTime() - now
          : 0;
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));

      res.setHeader('Retry-After', String(retryAfterSeconds));
      return sendResponse(res, {
        statusCode: httpStatus.TOO_MANY_REQUESTS,
        message: err.message,
        data: null,
      });
    }
    throw err;
  }
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.login(req.body);
  setAuthCookie(res, result.token);
  return sendResponse(res, {
    message: 'Login successful',
    data: result.user,
  });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  return sendResponse(res, { message: 'Logged out', data: null });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) throw ApiError.unauthorized();
  const user = await service.getCurrentUser(req.user.id);
  return sendResponse(res, { message: 'Authenticated', data: user });
});

/**
 * Ask for a password-reset code.
 *
 * The response is deliberately IDENTICAL whether or not the address is on
 * file. Telling the difference would turn this endpoint into an
 * account-enumeration oracle — an attacker could use it to discover
 * which customers have accounts.
 *
 * No auth cookie is set and no session is created: the customer still
 * has to prove they own the mailbox.
 */
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await passwordResetService.requestPasswordReset(
    req.body.email,
    req.ip ?? null
  );
  return sendResponse(res, {
    message:
      'If that email is on file, a reset code is on its way. Please check your inbox.',
    data: null,
  });
});

/**
 * Set a new password using a reset code.
 *
 * The customer is NOT signed in here. They set the password and then log
 * in normally — a stolen reset link alone must never hand over a
 * session.
 */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await passwordResetService.resetPasswordWithCode(
    req.body.email,
    req.body.code,
    req.body.password
  );
  return sendResponse(res, {
    message: 'Your password has been updated. You can now sign in.',
    data: { email: result.email },
  });
});
