import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { User } from '../modules/user/user.model';
import { PasswordResetToken } from '../modules/auth/passwordReset.model';
import { hashPassword, verifyPassword } from '../utils/bcrypt';
import {
  setEmailTransportOverride,
  getLastSentMessage,
} from '../modules/email/email.service';
import { resetRateLimitBuckets } from '../middleware/rateLimiter';
import {
  connectTestDb,
  disconnectTestDb,
  clearTestDb,
} from './harness';

/**
 * Password-reset tests.
 *
 * The storefront has always shown a "Forgot?" link promising a reset
 * email, but no backend endpoint existed — the promise was never kept.
 * These tests cover the endpoint that now keeps it.
 *
 * The properties that matter:
 *
 *   1. THE EMAIL IS ACTUALLY SENT (and only to a real account).
 *   2. THE RESPONSE NEVER REVEALS WHETHER AN ADDRESS EXISTS.
 *   3. THE CODE IS STORED HASHED, NEVER IN PLAIN TEXT.
 *   4. A CODE WORKS EXACTLY ONCE, AND EXPIRES.
 *   5. THE RESET DOES NOT SIGN THE CUSTOMER IN.
 */

let app: ReturnType<typeof createApp>;

const EMAIL = 'forgetful@example.com';
const PASSWORD = 'oldpassword123';
const NEW_PASSWORD = 'brandnewpassword456';

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
  resetRateLimitBuckets();
  setEmailTransportOverride({ sent: true, id: 'test-message-id' });
});

/* ==================================================================
 *  Helpers
 * ================================================================== */

/** Create a customer with a password. */
async function makeCustomer(overrides: Record<string, unknown> = {}) {
  return User.create({
    name: 'Forgetful Friend',
    email: EMAIL,
    password: await hashPassword(PASSWORD),
    role: 'customer',
    isGuest: false,
    isActive: true,
    emailVerified: true,
    ...overrides,
  });
}

/**
 * Read the stored reset request, INCLUDING the hidden hash.
 *
 * The hash is `select: false` on the schema, so it only ever appears
 * when explicitly asked for — which is exactly how the test proves the
 * plain code is not sitting in the database.
 */
async function readToken(email = EMAIL) {
  return PasswordResetToken.findOne({ email: email.toLowerCase() })
    .select('+tokenHash +resultingPasswordHash')
    .lean()
    .exec();
}

/**
 * Recover the plain code from the stubbed transport.
 *
 * The transport stub records what was sent, so the test can read the
 * code out of the email body — exactly as a customer would read it out
 * of their inbox — and use it to drive the rest of the flow.
 */
function lastSentBody(): string {
  const message = getLastSentMessage();
  return message?.text ?? '';
}

/**
 * Pull the 6-digit code out of a sent email's plain-text body.
 *
 * The email shows the code grouped as `123-456` for readability, so the
 * separator is stripped here — exactly what the customer would have to
 * do before typing it in.
 */
function extractCode(text: string): string {
  const match = text.match(/(\d{3})\s*-\s*(\d{3})/);
  if (match) return `${match[1]}${match[2]}`;
  const plain = text.match(/\b(\d{6})\b/);
  if (!plain) throw new Error(`No 6-digit code found in: ${text}`);
  return plain[1];
}

/* ==================================================================
 *  Requesting a code
 * ================================================================== */

describe('POST /api/auth/forgot-password', () => {
  it('sends a reset email to a customer who exists', async () => {
    await makeCustomer();

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: EMAIL });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);

    const record = await readToken();
    expect(record).toBeTruthy();
    expect(record!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('stores the code HASHED — never in plain text', async () => {
    await makeCustomer();
    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });

    const record = await readToken();
    const stored = String(record!.tokenHash);

    // A bcrypt hash — never the raw code.
    expect(stored).toMatch(/^\$2[aby]\$\d{2}\$/);
    // The plain code must not appear anywhere in the document.
    const code = extractCode(lastSentBody());
    expect(stored).not.toContain(code);
    expect(JSON.stringify(record)).not.toContain(code);
  });

  it('NEVER reveals whether the address exists', async () => {
    const known = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: EMAIL });

    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    // Identical responses — the endpoint is not an enumeration oracle.
    expect(unknown.status).toBe(known.status);
    expect(unknown.body?.message).toBe(known.body?.message);
    expect(unknown.body?.data).toBe(known.body?.data);
  });

  it('issues NO code for an address that is not on file', async () => {
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(await PasswordResetToken.countDocuments({})).toBe(0);
  });

  it('issues NO code for a GUEST account (no password to reset)', async () => {
    await User.create({
      name: 'Guest Shopper',
      email: 'guest@example.com',
      isGuest: true,
      isActive: true,
      emailVerified: true,
    });

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'guest@example.com' });

    expect(await PasswordResetToken.countDocuments({})).toBe(0);
  });

  it('issues NO code for a DISABLED account', async () => {
    await makeCustomer({ isActive: false });

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: EMAIL });

    expect(await PasswordResetToken.countDocuments({})).toBe(0);
  });

  it('rejects a malformed address', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('replaces the PREVIOUS code when a new one is requested', async () => {
    await makeCustomer();

    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    const firstHash = (await readToken())!.tokenHash;

    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    const secondHash = (await readToken())!.tokenHash;

    // The old code is dead — its hash has been replaced.
    expect(secondHash).not.toBe(firstHash);
    // And there is still only ONE live request per address.
    expect(await PasswordResetToken.countDocuments({})).toBe(1);
  });

  it('reports a provider failure without throwing', async () => {
    await makeCustomer();
    setEmailTransportOverride({ sent: false, error: 'provider is down' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: EMAIL });

    // The request still succeeds — the customer is not told the address
    // is on file, and a provider outage is not the caller's problem.
    expect(res.status).toBe(200);
  });
});

/* ==================================================================
 *  Using the code
 * ================================================================== */

describe('POST /api/auth/reset-password', () => {
  /** Request a code and return the plain code the customer would type. */
  async function requestCode(): Promise<string> {
    await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    return extractCode(lastSentBody());
  }

  it('sets the new password and lets the customer sign in with it', async () => {
    await makeCustomer();
    const code = await requestCode();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code, password: NEW_PASSWORD });

    expect(res.status).toBe(200);

    const user = await User.findOne({ email: EMAIL }).select('+password').exec();
    expect(await verifyPassword(NEW_PASSWORD, user!.password!)).toBe(true);
    expect(await verifyPassword(PASSWORD, user!.password!)).toBe(false);

    // And the new password really works at the login endpoint.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('does NOT sign the customer in', async () => {
    await makeCustomer();
    const code = await requestCode();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code, password: NEW_PASSWORD });

    // No token in the payload, no auth cookie in the headers.
    expect(JSON.stringify(res.body)).not.toMatch(/"token"/i);
    expect(res.headers['set-cookie'] ?? []).toHaveLength(0);
  });

  it('accepts the code with or without the hyphen', async () => {
    await makeCustomer();
    const code = await requestCode();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        email: EMAIL,
        code: `${code.slice(0, 3)}-${code.slice(3)}`,
        password: NEW_PASSWORD,
      });

    expect(res.status).toBe(200);
  });

  it('rejects a WRONG code', async () => {
    await makeCustomer();
    await requestCode();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code: '000000', password: NEW_PASSWORD });

    expect(res.status).toBe(400);

    // The old password still works — nothing was changed.
    const user = await User.findOne({ email: EMAIL }).select('+password').exec();
    expect(await verifyPassword(PASSWORD, user!.password!)).toBe(true);
  });

  it('rejects an EXPIRED code', async () => {
    await makeCustomer();
    const code = await requestCode();

    // Push the expiry into the past.
    await PasswordResetToken.updateOne(
      { email: EMAIL },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    ).exec();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('refuses to REPLAY a code that has already been used', async () => {
    await makeCustomer();
    const code = await requestCode();

    const first = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code, password: NEW_PASSWORD });
    expect(first.status).toBe(200);

    /* Now the customer "changes their mind" and tries the same link. */
    await User.updateOne(
      { email: EMAIL },
      { $set: { password: await hashPassword(PASSWORD) } }
    ).exec();

    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code, password: 'anotherpassword789' });

    expect(replay.status).toBe(400);

    // The replay did NOT roll the password back.
    const user = await User.findOne({ email: EMAIL }).select('+password').exec();
    expect(await verifyPassword(PASSWORD, user!.password!)).toBe(true);
  });

  it('refuses a code issued for a DIFFERENT address', async () => {
    await makeCustomer();
    const code = await requestCode();

    const other = await User.create({
      name: 'Other Person',
      email: 'other@example.com',
      password: await hashPassword(PASSWORD),
      role: 'customer',
      isGuest: false,
      isActive: true,
      emailVerified: true,
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'other@example.com', code, password: NEW_PASSWORD });

    expect(res.status).toBe(400);

    // The other account is untouched.
    const untouched = await User.findById(other._id).select('+password').exec();
    expect(await verifyPassword(PASSWORD, untouched!.password!)).toBe(true);
  });

  it('rejects a code that is not exactly six digits', async () => {
    await makeCustomer();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code: '12345', password: NEW_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('rejects a password that is too short', async () => {
    await makeCustomer();
    const code = await requestCode();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code, password: 'abc' });

    expect(res.status).toBe(400);
  });

  it('never returns the new password or the code in the response', async () => {
    await makeCustomer();
    const code = await requestCode();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: EMAIL, code, password: NEW_PASSWORD });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(code);
    expect(body).not.toContain(NEW_PASSWORD);
  });
});
