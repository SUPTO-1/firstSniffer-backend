import type { QueryConfig } from '../../utils/queryBuilder';

/** Re-export the User types — Customer is just a User filtered by role. */
export type {
  IAddress,
  IUser as ICustomer,
  UserDoc as CustomerDoc,
  PublicUser as PublicCustomer,
} from '../user/user.interface';

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: string | null;
  createdAt: string;
}

export interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  addresses: {
    id: string;
    label?: string;
    district: string;
    area: string;
    address: string;
    isDefault?: boolean;
  }[];
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const CUSTOMER_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'phone', 'email'],
  allowedFilters: {
    isActive: 'boolean',
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};
