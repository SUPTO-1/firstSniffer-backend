import { User } from '../user/user.model';
import { toPublicUser } from '../user/user.service';
import { ApiError } from '../../utils/ApiError';
import { hashPassword, verifyPassword } from '../../utils/bcrypt';
import { signToken } from '../../utils/jwt';
import type {
  AuthResult,
  LoginInput,
  RegisterInput,
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

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  const doc = await User.create({
    name: input.name,
    nickname: input.nickname ?? null,
    email: input.email,
    phone: input.phone ?? null,
    password: passwordHash,
    role: 'customer',
    isGuest: false,
    isActive: true,
    addresses: [],
  });

  return buildAuthResult(doc);
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const doc = await User.findOne({ email: input.email }).select('+password');
  // Generic error — never reveal whether email exists.
  const invalid = ApiError.unauthorized('Invalid email or password');

  if (!doc) throw invalid;
  if (!doc.password) throw invalid;
  if (!doc.isActive) throw ApiError.forbidden('This account has been disabled');

  const ok = await verifyPassword(input.password, doc.password);
  if (!ok) throw invalid;

  return buildAuthResult(doc);
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const doc = await User.findById(userId);
  return toPublicUser(doc);
}