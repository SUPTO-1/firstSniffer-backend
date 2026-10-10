import type { JwtPayload } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & {
        id?: string;
      };
    }
  }
}

export {};
