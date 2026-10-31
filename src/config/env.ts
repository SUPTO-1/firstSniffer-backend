import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root regardless of where the process is started.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function readString(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const num = Number(raw);
  if (Number.isNaN(num)) {
    throw new Error(`Env var ${key} must be a number, got: ${raw}`);
  }
  return num;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: readNumber('PORT', 5000),
  frontendUrl: readString('FRONTEND_URL', 'http://localhost:3000'),
  mongoUri: readString(
    'MONGODB_URI',
    'mongodb://admin:password@localhost:27017/firstsniffer?authSource=admin'
  ),
  jwt: {
    secret: readString('JWT_SECRET', 'dev-only-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  cookie: {
    name: process.env.COOKIE_NAME ?? 'fs_token',
    secure: readBool('COOKIE_SECURE', false),
  },
  /**
   * Resend — the ONLY email delivery provider.
   *
   * These are read with `process.env.X ?? ''` rather than `readString()` on
   * purpose. A missing API key must NOT crash the process at boot: email
   * failure is never allowed to break order creation, and a boot crash
   * would take the whole storefront down. The email service degrades to
   * "every send fails" and logs a clear message instead.
   */
  email: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? '',
  },
  /**
   * Registration OTP policy.
   *
   * These are deliberately NOT environment variables — they are product
   * rules, not deployment configuration. Changing them should be a code
   * change reviewed like any other.
   */
  otp: {
    /** How long an OTP stays valid. */
    ttlMs: 5 * 60 * 1000,
    /** How many times a single OTP may be guessed before it is dead. */
    maxAttempts: 5,
    /** How many EXPLICIT resends are allowed per window. */
    maxResends: 3,
    /** How long the resend button stays blocked after the last allowed resend. */
    cooldownMs: 30 * 60 * 1000,
  },
} as const;

export const isProd = env.nodeEnv === 'production';
