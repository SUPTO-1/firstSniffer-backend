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
} as const;

export const isProd = env.nodeEnv === 'production';
