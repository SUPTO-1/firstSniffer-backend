export type UserRole = 'admin' | 'customer';

export interface IAddress {
  _id?: unknown;
  label?: string;
  district: string;
  area: string;
  address: string;
  isDefault?: boolean;
}

export interface IUser {
  name: string;
  nickname?: string | null;
  email?: string | null;
  phone?: string | null;
  password?: string | null;
  role: UserRole;
  isGuest: boolean;
  addresses: IAddress[];
  isActive: boolean;
  /**
   * Whether the customer has confirmed ownership of their email address.
   *
   * `false` → registered but never entered the code. The customer can fix
   * this themselves, so login says "Please verify your email address
   * first." `true` + `isActive: false` → an admin disabled the account,
   * which the customer cannot fix.
   *
   * Defaults to `true` so existing accounts are never locked out.
   */
  emailVerified: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Lean shape returned to clients — never includes the password hash.
 * Mongoose serialises _id as id (string) thanks to the model transform.
 */
export interface PublicUser extends Omit<IUser, 'password'> {
  id: string;
  joinedAt?: string;
}

/** Hydrated Mongoose document shape used internally. */
import type { Document } from 'mongoose';
export type UserDoc = IUser & Document & { _id: unknown };

export interface UpdateProfileInput {
  name?: string;
  nickname?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface AddressInput {
  label?: string;
  district: string;
  area: string;
  address: string;
  isDefault?: boolean;
}

export interface UpdateAddressInput extends Partial<AddressInput> {}