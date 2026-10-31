export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  nickname?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: 'admin' | 'customer';
    nickname: string | null;
    createdAt?: Date;
    joinedAt?: string;
  };
}

/**
 * The response to a successful registration.
 *
 * Note there is NO token here — the account is not usable until the email
 * address is verified, so the JWT is only issued by `verifyOtp`.
 */
export interface RegisterResult {
  /** Always true — the caller must verify their email before signing in. */
  verificationRequired: true;
  /** The address the code was sent to. */
  email: string;
  /** When the code stops being valid. */
  expiresAt: Date;
  /**
   * Whether the email was actually accepted by the provider.
   *
   * `false` means the account exists but the code did not arrive (a
   * provider outage, or an unverified sending domain). The frontend uses
   * this to tell the customer to retry rather than leaving them waiting
   * for a code that will never arrive.
   */
  emailSent: boolean;
}

/** The response to a successful resend request. */
export interface ResendOtpResult {
  verificationRequired: true;
  email: string;
  expiresAt: Date;
  emailSent: boolean;
  /** How many explicit resends remain in the current window. */
  resendsRemaining: number;
}