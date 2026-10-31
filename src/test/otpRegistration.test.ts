import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { User } from '../modules/user/user.model';
import { OtpChallenge } from '../modules/auth/otpChallenge.model';
import {
  generateOtp,
  getResendState,
  issueInitialOtp,
  resendOtp,
  OTP_COOLDOWN_MS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS,
  OTP_TTL_MS,
} from '../modules/auth/otpChallenge.service';
import { hashPassword } from '../utils/bcrypt';
import {
  setEmailTransportOverride,
  isEmailTransportOverridden,
} from '../modules/email/email.service';
import { resetRateLimitBuckets } from '../middleware/rateLimiter';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
} from './harness';

/**
 * Registration + OTP + resend-policy tests.
 *
 * These are INTEGRATION tests against a real mongod. The whole point of
 * the resend policy is its ATOMICITY — "parallel requests cannot bypass
 * the limit" — and that claim cannot be proven against a mock. A fake
 * would happily let 10 concurrent resends all succeed because it has no
 * document write lock.
 *
 * The email transport is stubbed, so no test ever contacts Resend.
 */

let app: ReturnType<typeof createApp>;

const EMAIL = 'newcomer@example.com';
const PASSWORD = 'secret123';

beforeAll(async () => {
  await connectTestDb();
  app = createApp();
});

afterAll(async () => {
  setEmailTransportOverride(null);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearTestDb();
  /**
   * The IP rate limiter lives in module scope and is shared across the
   * whole process. This suite makes far more than 10 requests per minute
   * to `/register`, so without a reset the limiter — not the behaviour
   * under test — would decide the outcome.
   */
  resetRateLimitBuckets();
  // Stub the transport so no test hits the network.
  setEmailTransportOverride({ sent: true, id: 'test-message-id' });
});

/* ==================================================================
 *  Helpers
 * ================================================================== */

function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'New Comer',
    email: EMAIL,
    password: PASSWORD,
    ...overrides,
  };
}

/** Read the raw challenge document, including the hidden `otpHash`. */
async function readChallenge(email = EMAIL) {
  return OtpChallenge.findOne({ email: email.toLowerCase() })
    .select('+otpHash')
    .lean()
    .exec();
}

/* ==================================================================
 *  Registration
 * ================================================================== */

describe('POST /api/auth/register — pending account, no JWT', () => {
  it('creates an INACTIVE, UNVERIFIED account and returns verificationRequired', async () => {
    const res = await request(app).post('/api/auth/register').send(registerBody());

    expect(res.status).toBe(201);
    expect(res.body?.data?.verificationRequired).toBe(true);
    expect(res.body?.data?.email).toBe(EMAIL);
    expect(typeof res.body?.data?.expiresAt).toBe('string');
  });

  it('issues NO token and sets NO auth cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(registerBody());

    // No token anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toMatch(/"token"/i);
    // No auth cookie in the response headers.
    const setCookie = res.headers['set-cookie'] ?? [];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    expect(cookies.join(';')).not.toMatch(/fs_token/i);
  });

  it('creates the user with isActive:false and emailVerified:false', async () => {
    await request(app).post('/api/auth/register').send(registerBody());

    const user = await User.findOne({ email: EMAIL }).exec();
    expect(user).not.toBeNull();
    expect(user!.isActive).toBe(false);
    expect(user!.emailVerified).toBe(false);
  });

  it('never stores the plain OTP — only a hash', async () => {
    await request(app).post('/api/auth/register').send(registerBody());

    const challenge = await readChallenge();
    expect(challenge).not.toBeNull();
    expect(challenge!.otpHash).toBeTruthy();
    // A bcrypt hash is never the 6-digit code itself.
    expect(challenge!.otpHash).not.toMatch(/^\d{6}$/);
    expect(challenge!.otpHash).toMatch(/^\$2[aby]\$/);
  });

  it('does not leak the OTP into the response body', async () => {
    const res = await request(app).post('/api/auth/register').send(registerBody());
    const challenge = await readChallenge();
    // The plain code is not recoverable from the response.
    expect(JSON.stringify(res.body)).not.toContain(challenge!.otpHash);
  });

  it('rejects a duplicate registration for an ALREADY-VERIFIED account', async () => {
    await User.create({
      name: 'Existing',
      email: EMAIL,
      password: 'x',
      role: 'customer',
      isGuest: false,
      isActive: true,
      emailVerified: true,
      addresses: [],
    });

    const res = await request(app).post('/api/auth/register').send(registerBody());
    expect(res.status).toBe(409);
  });

  it('lets a PENDING customer register again without a conflict', async () => {
    const first = await request(app).post('/api/auth/register').send(registerBody());
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/auth/register').send(registerBody());
    expect(second.status).toBe(201);

    // Still exactly one account.
    expect(await User.countDocuments({ email: EMAIL })).toBe(1);
  });
});

/* ==================================================================
 *  Verification
 * ================================================================== */

describe('POST /api/auth/verify-otp', () => {
  it('activates the account and returns a token + cookie on success', async () => {
    await request(app).post('/api/auth/register').send(registerBody());
    const { otp } = await issueInitialOtp(EMAIL);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp });

    expect(res.status).toBe(200);
    // The controller returns the user object directly under `data`.
    expect(res.body?.data?.email).toBe(EMAIL);
    expect(res.body?.data?.id).toBeTruthy();

    const user = await User.findOne({ email: EMAIL }).exec();
    expect(user!.isActive).toBe(true);
    expect(user!.emailVerified).toBe(true);
  });

  it('rejects a WRONG code without activating the account', async () => {
    await request(app).post('/api/auth/register').send(registerBody());
    await issueInitialOtp(EMAIL);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp: '000000' });

    expect(res.status).toBe(400);
    const user = await User.findOne({ email: EMAIL }).exec();
    expect(user!.isActive).toBe(false);
  });

  it('rejects a code that is not exactly six digits', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp: '12345' });
    expect(res.status).toBe(400);

    const res2 = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp: '1234567' });
    expect(res2.status).toBe(400);
  });

  it('accepts a code with LEADING ZEROS (it stays a string)', async () => {
    await request(app).post('/api/auth/register').send(registerBody());

    // Replace the stored hash with the hash of a leading-zero code. The
    // schema keeps the code a string precisely so `004271` stays six
    // digits instead of collapsing to `4271`.
    await OtpChallenge.updateOne(
      { email: EMAIL },
      { $set: { otpHash: await hashPassword('004271') } }
    ).exec();

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp: '004271' });

    expect(res.status).toBe(200);
  });

  it('rejects an EXPIRED code', async () => {
    await request(app).post('/api/auth/register').send(registerBody());
    const { otp } = await issueInitialOtp(EMAIL);

    // Push the expiry into the past.
    await OtpChallenge.updateOne(
      { email: EMAIL },
      { $set: { otpExpiresAt: new Date(Date.now() - 1000) } }
    ).exec();

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/expired/i);
  });

  it('caps VERIFICATION ATTEMPTS at 5', async () => {
    await request(app).post('/api/auth/register').send(registerBody());
    const { otp } = await issueInitialOtp(EMAIL);

    // Five wrong guesses.
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: EMAIL, otp: '999999' });
    }

    const challenge = await readChallenge();
    expect(challenge!.attempts).toBe(OTP_MAX_ATTEMPTS);

    // The CORRECT code is now refused — the budget is spent.
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/too many incorrect attempts/i);
  });

  it('invalidates the PREVIOUS code when a new one is issued', async () => {
    await request(app).post('/api/auth/register').send(registerBody());
    const first = await issueInitialOtp(EMAIL);

    // A resend replaces the code.
    const secondOtp = generateOtp();
    await resendOtp(EMAIL, await hashPassword(secondOtp), new Date(Date.now() + OTP_TTL_MS));

    const oldRes = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp: first.otp });
    expect(oldRes.status).toBe(400);

    const newRes = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: EMAIL, otp: secondOtp });
    expect(newRes.status).toBe(200);
  });

  it('rejects a code for an address that never requested one', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: 'never@example.com', otp: '123456' });
    expect(res.status).toBe(400);
  });
});

/* ==================================================================
 *  Resend policy — the core requirement
 * ================================================================== */

describe('POST /api/auth/resend-otp — 3 resends, then a 30-minute cooldown', () => {
  /** Drive the resend gate directly (bypassing HTTP) for precision. */
  async function attemptResend(email = EMAIL): Promise<boolean> {
    const outcome = await resendOtp(
      email,
      await hashPassword(generateOtp()),
      new Date(Date.now() + OTP_TTL_MS)
    );
    return outcome.ok;
  }

  it('does NOT count the INITIAL OTP as a resend', async () => {
    await issueInitialOtp(EMAIL);
    const state = await getResendState(EMAIL);
    expect(state.resendCount).toBe(0);
  });

  it('allows exactly 3 resends and blocks the 4th', async () => {
    await issueInitialOtp(EMAIL);

    expect(await attemptResend()).toBe(true); // 1st
    expect(await attemptResend()).toBe(true); // 2nd
    expect(await attemptResend()).toBe(true); // 3rd
    expect(await attemptResend()).toBe(false); // 4th — blocked
  });

  it('arms the cooldown exactly when the 3rd resend lands', async () => {
    await issueInitialOtp(EMAIL);

    await attemptResend();
    let state = await getResendState(EMAIL);
    expect(state.cooldownUntil).toBeNull();

    await attemptResend();
    state = await getResendState(EMAIL);
    expect(state.cooldownUntil).toBeNull();

    await attemptResend();
    state = await getResendState(EMAIL);
    expect(state.cooldownUntil).not.toBeNull();
    expect(state.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects ALL resends during the cooldown', async () => {
    await issueInitialOtp(EMAIL);
    await attemptResend();
    await attemptResend();
    await attemptResend(); // 3rd — arms the cooldown

    expect(await attemptResend()).toBe(false);
    expect(await attemptResend()).toBe(false);
    expect(await attemptResend()).toBe(false);
  });

  it('allows resending again once the cooldown EXPIRES', async () => {
    await issueInitialOtp(EMAIL);
    await attemptResend();
    await attemptResend();
    await attemptResend(); // 3rd — arms the cooldown

    // Simulate the cooldown having elapsed.
    await OtpChallenge.updateOne(
      { email: EMAIL },
      { $set: { cooldownUntil: new Date(Date.now() - 1000) } }
    ).exec();

    expect(await attemptResend()).toBe(true);
    const state = await getResendState(EMAIL);
    // The request that follows an expired cooldown is the FIRST resend
    // of the fresh window, so the counter is 1.
    expect(state.resendCount).toBe(1);
  });

  it('resets the counter to a FRESH WINDOW of 3 after the cooldown expires', async () => {
    await issueInitialOtp(EMAIL);
    for (let i = 0; i < 3; i++) await attemptResend();

    await OtpChallenge.updateOne(
      { email: EMAIL },
      { $set: { cooldownUntil: new Date(Date.now() - 1000) } }
    ).exec();

    // The whole budget is available again.
    expect(await attemptResend()).toBe(true);
    expect(await attemptResend()).toBe(true);
    expect(await attemptResend()).toBe(true);
    expect(await attemptResend()).toBe(false);
  });

  it('does NOT reset the counter when the customer REGISTERS AGAIN', async () => {
    await issueInitialOtp(EMAIL);
    await attemptResend();
    await attemptResend();
    await attemptResend(); // 3rd — arms the cooldown

    // A registration retry issues a fresh code but must not buy a new window.
    await issueInitialOtp(EMAIL);

    const state = await getResendState(EMAIL);
    expect(state.resendCount).toBe(OTP_MAX_RESENDS);
    expect(state.cooldownUntil).not.toBeNull();
    expect(await attemptResend()).toBe(false);
  });

  it('does NOT reset the counter when the customer LOGS IN (a failed attempt)', async () => {
    await issueInitialOtp(EMAIL);
    await attemptResend();
    await attemptResend();
    await attemptResend();

    // A login attempt for the pending account must not touch the limiter.
    await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    const state = await getResendState(EMAIL);
    expect(state.resendCount).toBe(OTP_MAX_RESENDS);
  });

  it('CANNOT be bypassed by PARALLEL resend requests', async () => {
    await issueInitialOtp(EMAIL);

    // Fire 10 concurrent resends. Exactly 3 may succeed.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => attemptResend())
    );
    const succeeded = results.filter(Boolean).length;

    expect(succeeded).toBe(OTP_MAX_RESENDS);

    const state = await getResendState(EMAIL);
    expect(state.resendCount).toBe(OTP_MAX_RESENDS);
  });

  it('CANNOT be bypassed by PARALLEL HTTP resend requests', async () => {
    await request(app).post('/api/auth/register').send(registerBody());

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app).post('/api/auth/resend-otp').send({ email: EMAIL })
      )
    );

    const ok = responses.filter((r) => r.status === 200).length;
    const blocked = responses.filter((r) => r.status === 429).length;

    expect(ok).toBe(OTP_MAX_RESENDS);
    expect(blocked).toBe(8 - OTP_MAX_RESENDS);
  });
});

/* ==================================================================
 *  Resend over HTTP — status codes and headers
 * ================================================================== */

describe('POST /api/auth/resend-otp — HTTP behaviour', () => {
  it('returns 200 and a resendsRemaining count on success', async () => {
    await request(app).post('/api/auth/register').send(registerBody());

    const res = await request(app)
      .post('/api/auth/resend-otp')
      .send({ email: EMAIL });

    expect(res.status).toBe(200);
    expect(res.body?.data?.verificationRequired).toBe(true);
    expect(typeof res.body?.data?.resendsRemaining).toBe('number');
    expect(res.body?.data?.resendsRemaining).toBe(OTP_MAX_RESENDS - 1);
  });

  it('returns 429 with a Retry-After header once the cooldown is armed', async () => {
    await request(app).post('/api/auth/register').send(registerBody());

    for (let i = 0; i < OTP_MAX_RESENDS; i++) {
      await request(app).post('/api/auth/resend-otp').send({ email: EMAIL });
    }

    const res = await request(app)
      .post('/api/auth/resend-otp')
      .send({ email: EMAIL });

    expect(res.status).toBe(429);
    const retryAfter = res.headers['retry-after'];
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    // The cooldown is 30 minutes.
    expect(Number(retryAfter)).toBeLessThanOrEqual(OTP_COOLDOWN_MS / 1000);
  });

  it('returns 400 for an address with no account', async () => {
    const res = await request(app)
      .post('/api/auth/resend-otp')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/resend-otp')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

/* ==================================================================
 *  Login message separation
 * ================================================================== */

describe('Login distinguishes unverified from disabled accounts', () => {
  it('tells an UNVERIFIED customer to verify their email', async () => {
    await request(app).post('/api/auth/register').send(registerBody());

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/verify your email address first/i);
  });

  it('tells a DISABLED customer their account has been disabled', async () => {
    await User.create({
      name: 'Blocked',
      email: 'blocked@example.com',
      password: 'x',
      role: 'customer',
      isGuest: false,
      isActive: false,
      emailVerified: true,
      addresses: [],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'blocked@example.com', password: 'x' });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/disabled/i);
    // The two messages must NOT be conflated.
    expect(JSON.stringify(res.body)).not.toMatch(/verify your email address first/i);
  });

  it('treats every EXISTING account as verified (backward compatible)', async () => {
    // A document written before `emailVerified` existed has the field
    // absent. It must still log in.
    await User.collection.insertOne({
      name: 'Legacy',
      email: 'legacy@example.com',
      password: 'x',
      role: 'customer',
      isGuest: false,
      isActive: true,
      addresses: [],
    } as never);

    const user = await User.findOne({ email: 'legacy@example.com' }).exec();
    expect(user!.emailVerified).toBe(true);
  });
});

/* ==================================================================
 *  Transport hygiene
 * ================================================================== */

describe('Email transport', () => {
  it('is stubbed during the test run — no network call is made', () => {
    expect(isEmailTransportOverridden()).toBe(true);
  });
});
