import { User } from '../user/user.model';
import type { UserDoc } from '../user/user.interface';
import type { IGuestInfo } from './order.interface';

/**
 * Guest identity.
 *
 * A guest checkout needs a `User` row so that:
 *   - the order can reference a customer (Admin Orders shows the buyer),
 *   - the guest is searchable in the Admin Customers module,
 *   - customer-level metrics (order count, lifetime spend) work.
 *
 * BUT the guest must never be mistaken for a registered account:
 *   - `isGuest: true` marks them,
 *   - `password: null` means they can NEVER log in — `auth.service.login()`
 *     already rejects a user with no password (`if (!doc.password) throw invalid`),
 *   - `email` is left null unless the guest supplied one.
 *
 * IMPORTANT — NO AUTOMATIC MERGING
 * --------------------------------
 * A guest is matched to an existing user record by phone number ONLY so that
 * repeated guest orders by the same person do not create a duplicate row.
 * We NEVER transfer guest orders onto a REGISTERED account, and we never
 * treat a matching phone number as proof of identity.
 *
 * The reason is concrete: phone numbers in Bangladesh are transferable and
 * typos are common. If we auto-merged on a phone match, an order could end
 * up attached to someone else's account — leaking one customer's order
 * history to another, and letting a stranger see an order (and its address)
 * by entering a phone number they guessed. Claiming a guest order requires
 * verifying the phone number out-of-band, which is a separate, future
 * feature.
 */

/** A guest user row found by phone, or null. */
export interface GuestUserRef {
  id: string;
  isGuest: boolean;
}

/**
 * Find the guest user row for a phone number, or create one.
 *
 * Only rows with `isGuest: true` are matched. A REGISTERED account that
 * happens to share the phone number is deliberately NOT returned — a guest
 * checkout must never attach an order to somebody else's account, and
 * creating a separate guest row keeps the two histories apart.
 */
export async function findOrCreateGuestUser(
  guestInfo: Pick<IGuestInfo, 'name' | 'phone' | 'email' | 'district' | 'area' | 'address'>
): Promise<GuestUserRef> {
  const phone = guestInfo.phone.trim();

  const existing = await User.findOne({ phone, isGuest: true })
    .select('_id isGuest')
    .lean()
    .exec();

  if (existing) {
    return { id: String(existing._id), isGuest: true };
  }

  const email = guestInfo.email?.trim().toLowerCase();

  const created = await User.create({
    name: guestInfo.name.trim(),
    // The `email` key must be OMITTED entirely when the guest did not
    // supply one — NOT set to `null`. The users collection has a
    // `unique + sparse` index on `email`, and a sparse index only skips
    // documents where the field is ABSENT. Writing `email: null` would
    // make the SECOND guest without an email collide with the first
    // (E11000), failing their checkout. See `user.model.ts`.
    ...(email ? { email } : {}),
    phone,
    // No password — a guest can never authenticate.
    password: null,
    role: 'customer',
    isGuest: true,
    isActive: true,
    addresses: [
      {
        label: 'Home',
        district: guestInfo.district,
        area: guestInfo.area,
        address: guestInfo.address,
        isDefault: true,
      },
    ],
  });

  return { id: String(created._id), isGuest: true };
}

/**
 * Fetch a guest user row for display, without exposing anything sensitive.
 */
export async function getGuestUserById(
  id: string
): Promise<(UserDoc & { _id: unknown }) | null> {
  return (await User.findById(id)
    .select('name phone email role isGuest addresses isActive')
    .exec()) as (UserDoc & { _id: unknown }) | null;
}
