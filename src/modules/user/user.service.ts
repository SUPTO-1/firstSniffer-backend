import { User } from './user.model';
import { ApiError } from '../../utils/ApiError';
import type {
  AddressInput,
  IAddress,
  PublicUser,
  UpdateAddressInput,
  UpdateProfileInput,
  UserDoc,
} from './user.interface';

type AddressDoc = IAddress & {
  _id?: { toString(): string } | string;
};

/**
 * Map a Mongoose user document to its public (client-safe) shape.
 *
 * Reads fields directly off the doc instead of calling `.toObject()` —
 * the schema's `toJSON/toObject` transforms rename `_id` to `id` and drop
 * the raw `_id`, which would make `String(_id)` yield `"undefined"`.
 */
export function toPublicUser(doc: UserDoc | null): PublicUser {
  if (!doc) throw ApiError.notFound('User not found');
  const raw = doc as unknown as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
  };
  return {
    id: raw._id ? String(raw._id) : '',
    name: raw.name as string,
    nickname: (raw.nickname as string | null) ?? null,
    email: (raw.email as string | null) ?? null,
    phone: (raw.phone as string | null) ?? null,
    role: (raw.role as 'admin' | 'customer') ?? 'customer',
    isGuest: !!raw.isGuest,
    isActive: raw.isActive !== false,
    emailVerified: raw.emailVerified !== false,
    addresses: (raw.addresses as IAddress[]) ?? [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt as Date | undefined,
    joinedAt: raw.createdAt?.toISOString?.(),
  };
}

export async function getProfileById(userId: string): Promise<PublicUser> {
  const doc = await User.findById(userId);
  return toPublicUser(doc);
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<PublicUser> {
  const doc = await User.findById(userId);
  if (!doc) throw ApiError.notFound('User not found');

  if (input.name !== undefined) doc.name = input.name;
  if (input.nickname !== undefined) doc.nickname = input.nickname;
  if (input.phone !== undefined) doc.phone = input.phone;

  if (input.email !== undefined) {
    const next = (input.email ?? '').trim().toLowerCase();
    const current = (doc.email ?? '').trim().toLowerCase();
    if (next !== current) {
      if (next) {
        // Reject emails already taken by another user. The unique-sparse
        // index would also catch this, but we want a friendly error
        // message instead of a raw E11000.
        const clash = await User.findOne({ email: next }).select('_id').lean();
        if (clash && String(clash._id) !== String(doc._id)) {
          throw ApiError.conflict('That email is already in use');
        }
      }
      doc.email = next || null;
    }
  }

  await doc.save();
  return toPublicUser(doc);
}

export async function addAddress(
  userId: string,
  input: AddressInput
): Promise<PublicUser> {
  const doc = await User.findById(userId);
  if (!doc) throw ApiError.notFound('User not found');

  const isDefault = input.isDefault ?? doc.addresses.length === 0;

  if (isDefault) {
    doc.addresses.forEach((a) => {
      a.isDefault = false;
    });
  }

  doc.addresses.push({
    label: input.label,
    district: input.district,
    area: input.area,
    address: input.address,
    isDefault,
  });

  await doc.save();
  return toPublicUser(doc);
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: UpdateAddressInput
): Promise<PublicUser> {
  const doc = await User.findById(userId);
  if (!doc) throw ApiError.notFound('User not found');

  const addr = (doc.addresses as unknown as AddressDoc[]).find(
    (a) => String(a._id) === addressId
  );
  if (!addr) throw ApiError.notFound('Address not found');

  if (input.label !== undefined) addr.label = input.label;
  if (input.district !== undefined) addr.district = input.district;
  if (input.area !== undefined) addr.area = input.area;
  if (input.address !== undefined) addr.address = input.address;

  if (input.isDefault === true) {
    (doc.addresses as unknown as AddressDoc[]).forEach((a) => {
      a.isDefault = String(a._id) === addressId;
    });
  } else if (input.isDefault === false) {
    addr.isDefault = false;
  }

  await doc.save();
  return toPublicUser(doc);
}

export async function setDefaultAddress(
  userId: string,
  addressId: string
): Promise<PublicUser> {
  return updateAddress(userId, addressId, { isDefault: true });
}

export async function deleteAddress(
  userId: string,
  addressId: string
): Promise<PublicUser> {
  const doc = await User.findById(userId);
  if (!doc) throw ApiError.notFound('User not found');

  const addresses = doc.addresses as unknown as AddressDoc[];
  const idx = addresses.findIndex((a) => String(a._id) === addressId);
  if (idx === -1) throw ApiError.notFound('Address not found');

  const wasDefault = !!addresses[idx].isDefault;
  addresses.splice(idx, 1);

  if (wasDefault && addresses.length > 0) {
    addresses[0].isDefault = true;
  }

  await doc.save();
  return toPublicUser(doc);
}