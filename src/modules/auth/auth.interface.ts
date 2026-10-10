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