import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { rateLimiter } from '../../middleware/rateLimiter';
import { validate } from '../../middleware/validateRequest';
import * as controller from './auth.controller';
import {
  loginSchema,
  registerSchema,
  resendOtpSchema,
  verifyOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.validation';

const router = Router();

/**
 * PUBLIC routes — no `authRequired`.
 *
 * A customer cannot be signed in yet when they are registering, verifying
 * their code, or asking for a new one, so these three endpoints must stay
 * reachable without a token.
 *
 * RATE LIMITING: the IP limiter is a coarse outer bound (it stops a bot
 * from hammering the endpoint from one address). The REAL resend limit is
 * the MongoDB-backed 3-resend / 30-minute cooldown inside
 * `otpChallenge.service`, which is per-customer and survives restarts,
 * replicas, and device changes. The two layers are complementary: the IP
 * limiter protects the server, the Mongo limiter protects the customer.
 */
router.post(
  '/register',
  rateLimiter({ windowMs: 60_000, max: 10 }),
  validate(registerSchema),
  controller.register
);
router.post(
  '/verify-otp',
  rateLimiter({ windowMs: 60_000, max: 20 }),
  validate(verifyOtpSchema),
  controller.verifyOtp
);
router.post(
  '/resend-otp',
  rateLimiter({ windowMs: 60_000, max: 20 }),
  validate(resendOtpSchema),
  controller.resendOtp
);

router.post('/login', validate(loginSchema), controller.login);
router.post('/logout', controller.logout);
router.get('/me', authRequired, controller.me);

/**
 * Password reset.
 *
 * These are public — a customer who cannot sign in is by definition not
 * authenticated. The IP rate limiter is the coarse outer bound; the
 * attempt cap on the code itself (in `passwordReset.service`) is the
 * real defence against brute-forcing a 6-digit code.
 */
router.post(
  '/forgot-password',
  rateLimiter({ windowMs: 60_000, max: 10 }),
  validate(forgotPasswordSchema),
  controller.forgotPassword
);
router.post(
  '/reset-password',
  rateLimiter({ windowMs: 60_000, max: 20 }),
  validate(resetPasswordSchema),
  controller.resetPassword
);

export default router;
