import { User } from '../modules/user/user.model';
import { hashPassword } from '../utils/bcrypt';

interface AdminSeedConfig {
  name: string;
  nickname: string;
  email: string;
  password: string;
}

/**
 * Result of a seed run — kept small so callers can log / branch on it.
 */
export interface SeedResult {
  status: 'created' | 'skipped';
  email: string;
}

/**
 * Build the admin seed config from environment variables.
 * Throws early with a helpful message if anything is missing so the
 * process fails fast instead of starting with a half-configured admin.
 */
function readAdminConfig(): AdminSeedConfig {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'FirstSniffer Admin';
  const nickname = process.env.ADMIN_NICKNAME?.trim() || 'Admin';

  const missing: string[] = [];
  if (!email) missing.push('ADMIN_EMAIL');
  if (!password) missing.push('ADMIN_PASSWORD');

  if (missing.length) {
    throw new Error(
      `[seed] Cannot seed admin — missing env var(s): ${missing.join(', ')}. ` +
        `Add them to your .env file.`
    );
  }

  return { name, nickname, email: email as string, password: password as string };
}

/**
 * Idempotently create the admin user.
 * - Reads credentials from process.env (never hardcoded).
 * - Returns immediately if a user with that email already exists.
 * - Hashes the password with bcrypt before persisting.
 *
 * Safe to call on every boot — uses an atomic check-then-create guarded
 * by the unique-sparse index on `email`.
 */
export async function seedAdmin(): Promise<SeedResult> {
  const cfg = readAdminConfig();

  // Fast-path existence check. Cheap because `email` is indexed.
  const existing = await User.findOne({ email: cfg.email })
    .select('_id role')
    .lean();

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`[seed] Admin already exists (${cfg.email})`);
    return { status: 'skipped', email: cfg.email };
  }

  const hashedPassword = await hashPassword(cfg.password);

  try {
    await User.create({
      name: cfg.name,
      nickname: cfg.nickname,
      email: cfg.email,
      phone: null,
      password: hashedPassword,
      role: 'admin',
      isGuest: false,
      isActive: true,
      addresses: [],
    });
  } catch (err) {
    // Race condition guard: two pods booting at once can both miss the
    // existence check above. The unique-sparse index on `email` makes
    // the duplicate insert throw — treat that as success.
    const code = (err as { code?: number })?.code;
    if (code === 11000) {
      // eslint-disable-next-line no-console
      console.log(`[seed] Admin already exists (${cfg.email})`);
      return { status: 'skipped', email: cfg.email };
    }
    throw err;
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] Admin seeded successfully (${cfg.email})`);
  return { status: 'created', email: cfg.email };
}
