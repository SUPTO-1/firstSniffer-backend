import type { ClientSession } from 'mongoose';
import { InventoryLog } from './inventoryLog.model';
import {
  executePagedQuery,
  type PagedResult,
} from '../../utils/queryBuilder';
import type {
  IInventoryLog,
  InventoryLogDoc,
  InventoryLogType,
  PublicInventoryLog,
  PublicInventoryLogUserRef,
} from './inventoryLog.interface';
import { INVENTORY_LOG_QUERY_CONFIG } from './inventoryLog.interface';

export interface WriteLogInput {
  inventory: string;
  product: string;
  type: InventoryLogType;
  quantityMl: number;
  note?: string;
  referenceId?: string;
  createdBy?: string;
}

function pickPopulatedProduct(v: unknown): { id: string; name: string; slug: string } | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Record<string, unknown>;
  return {
    id: raw._id ? String(raw._id) : '',
    name: String(raw.name ?? ''),
    slug: String(raw.slug ?? ''),
  };
}

function pickPopulatedUser(v: unknown): PublicInventoryLogUserRef | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Record<string, unknown>;
  return {
    id: raw._id ? String(raw._id) : '',
    name: String(raw.name ?? ''),
    email: String(raw.email ?? ''),
  };
}

export function toPublicInventoryLog(doc: unknown): PublicInventoryLog {
  const raw = doc as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  };
  return {
    id: raw._id ? String(raw._id) : '',
    inventory: raw.inventory ? String(raw.inventory) : '',
    product: pickPopulatedProduct(raw.product),
    type: (raw.type as InventoryLogType) ?? 'add',
    quantityMl: Number(raw.quantityMl ?? 0),
    referenceId:
      typeof raw.referenceId === 'string' && raw.referenceId.length > 0
        ? raw.referenceId
        : null,
    note: String(raw.note ?? ''),
    createdBy: pickPopulatedUser(raw.createdBy),
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

/**
 * Internal helper used by the inventory service to write one log row per
 * mutation. Accepts an optional Mongoose session so a future change to use
 * Mongo transactions is a one-line addition.
 */
export async function writeLog(
  input: WriteLogInput,
  session?: ClientSession
): Promise<void> {
  const payload: Partial<IInventoryLog> = {
    inventory: input.inventory as unknown as IInventoryLog['inventory'],
    product: input.product as unknown as IInventoryLog['product'],
    type: input.type,
    quantityMl: input.quantityMl,
    referenceId: input.referenceId ?? undefined,
    note: input.note ?? '',
  };
  if (input.createdBy) {
    payload.createdBy = input.createdBy as unknown as IInventoryLog['createdBy'];
  }
  await InventoryLog.create([payload], { session });
}

export function listInventoryLogs(
  queryStr: Record<string, unknown>
): Promise<PagedResult<PublicInventoryLog>> {
  // List view runs `.lean()` via executePagedQuery. We map each row through
  // toPublicInventoryLog so createdBy / product are normalized from populated
  // objects (when present) to the public shape.
  return executePagedQuery<InventoryLogDoc>(
    InventoryLog as unknown as import('mongoose').Model<InventoryLogDoc>,
    queryStr,
    INVENTORY_LOG_QUERY_CONFIG
  ).then((res) => ({
    ...res,
    results: res.results.map((row) => toPublicInventoryLog(row)),
  }));
}
