import type { CookieOptions, Response } from 'express';
import { env, isProd } from './env';

export const AUTH_COOKIE_NAME = env.cookie.name;

export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.cookie.secure || isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days — matches JWT default expiry
  };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.cookie.secure || isProd,
    sameSite: 'lax',
    path: '/',
  });
}
