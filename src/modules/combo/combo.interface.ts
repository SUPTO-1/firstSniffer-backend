import type { Document, Types } from 'mongoose';
import type { QueryConfig } from '../../utils/queryBuilder';

export type ComboSize = '3ml' | '5ml' | '10ml' | '15ml' | '30ml';

export interface IComboComponent {
  product: Types.ObjectId;
  size: ComboSize;
  millilitres: number;
}

export interface ICombo {
  name: string;
  slug: string;
  products: IComboComponent[];
  comboPrice: number;
  image?: { url: string; fileId: string };
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ComboDoc = ICombo & Document & { _id: unknown };

export interface PublicComboComponent {
  product: string;
  size: ComboSize;
  ml: number;
}

export interface PublicCombo {
  id: string;
  name: string;
  slug: string;
  products: PublicComboComponent[];
  comboPrice: number;
  image?: { url: string; fileId: string } | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const COMBO_QUERY_CONFIG: QueryConfig = {
  searchFields: ['name', 'slug'],
  allowedFilters: {
    isActive: 'boolean',
  },
  defaultSort: '-createdAt',
  maxLimit: 100,
};