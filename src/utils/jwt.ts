import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string; // user id
  email?: string;
  role?: 'admin' | 'customer';
}

export function signToken(
  payload: JwtPayload,
  expiresIn: string | number = env.jwt.expiresIn
): string {
  const options: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.jwt.secret, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwt.secret) as JwtPayload;
}