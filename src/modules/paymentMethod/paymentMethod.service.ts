import { PaymentMethod } from './paymentMethod.model';
import { ApiError } from '../../utils/ApiError';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import {
  PAYMENT_METHOD_QUERY_CONFIG,
  type IPaymentMethod,
  type PaymentMethodDoc,
  type PublicPaymentMethod,
} from './paymentMethod.interface';

const WRITABLE_PAYMENT_METHOD_KEYS = [
  'name',
  'type',
  'accountNumber',
  'accountName',
  'qrImage',
  'instructions',
  'displayOrder',
  'isActive',
  'advancePaymentRequired',
  'advancePaymentPercent',
] as const;

export function toPublicPaymentMethod(doc: PaymentMethodDoc | null): PublicPaymentMethod {
  if (!doc) throw ApiError.notFound('Payment method not found');
  const raw = doc as unknown as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  };
  const qr = raw.qrImage as { url?: string; fileId?: string } | undefined;
  const qrImage =
    qr && (qr.url || qr.fileId)
      ? { url: qr.url ?? '', fileId: qr.fileId ?? '' }
      : null;
  return {
    id: raw._id ? String(raw._id) : '',
    name: raw.name as string,
    type: raw.type as PublicPaymentMethod['type'],
    accountNumber: (raw.accountNumber as string) ?? '',
    accountName: (raw.accountName as string) ?? '',
    qrImage,
    instructions: (raw.instructions as string[]) ?? [],
    displayOrder: (raw.displayOrder as number) ?? 0,
    isActive: raw.isActive !== false,
    advancePaymentRequired: raw.advancePaymentRequired === true,
    advancePaymentPercent:
      typeof raw.advancePaymentPercent === 'number'
        ? raw.advancePaymentPercent
        : 0,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

/**
 * Enforce the advance-payment invariant at the SERVICE layer.
 *
 * The HTTP routes already validate this through the Zod schema
 * (`createPaymentMethodSchema` / `updatePaymentMethodSchema`), but the
 * service is reachable from other places too — a seed script, an admin
 * job, a future internal caller. A single unguarded write path would
 * let a method end up configured as "advance required, 0%", which
 * contradicts itself: the admin's toggle says money is due up front
 * while the percentage says nothing is.
 *
 * Failing loudly at the service boundary means the invalid state can
 * never be persisted, however the write was attempted.
 */
function assertValidAdvanceConfig(input: {
  advancePaymentRequired?: boolean;
  advancePaymentPercent?: number;
}): void {
  if (input.advancePaymentRequired !== true) return;

  const percent = Number(input.advancePaymentPercent ?? 0);
  if (!Number.isFinite(percent) || percent <= 0) {
    throw ApiError.badRequest(
      'Advance payment percentage must be greater than 0'
    );
  }
  if (percent > 100) {
    throw ApiError.badRequest(
      'Advance payment percentage cannot be greater than 100'
    );
  }
}

export async function createPaymentMethod(
  input: Partial<IPaymentMethod>
): Promise<PublicPaymentMethod> {
  assertValidAdvanceConfig(input);
  // `cod` doesn't need an account — leave the fields empty.
  // Other types get their empty defaults as well so the public shape
  // is consistent.
  const doc = await PaymentMethod.create(input);
  return toPublicPaymentMethod(doc);
}

export function listPaymentMethods(
  queryStr: Record<string, unknown>
): Promise<PagedResult<IPaymentMethod>> {
  return executePagedQuery<IPaymentMethod>(
    PaymentMethod as unknown as import('mongoose').Model<IPaymentMethod>,
    queryStr,
    PAYMENT_METHOD_QUERY_CONFIG
  );
}

export async function listActivePaymentMethods(): Promise<PublicPaymentMethod[]> {
  const rows = await PaymentMethod.find({ isActive: true })
    .sort({ displayOrder: 1, name: 1 })
    .lean<PaymentMethodDoc[]>()
    .exec();
  return rows.map(toPublicPaymentMethod);
}

export async function getPaymentMethodById(id: string): Promise<PublicPaymentMethod> {
  const doc = await PaymentMethod.findById(id);
  return toPublicPaymentMethod(doc);
}

export async function updatePaymentMethod(
  id: string,
  input: Partial<IPaymentMethod>
): Promise<PublicPaymentMethod> {
  const existing = await PaymentMethod.findById(id);
  if (!existing) throw ApiError.notFound('Payment method not found');

  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_PAYMENT_METHOD_KEYS
  );

  /**
   * The advance invariant is checked against the MERGED result, not just
   * the incoming fields.
   *
   * A partial update can create an invalid state in two ways:
   *
   *   - The admin turns the toggle ON but sends no percentage. The
   *     existing percentage (0) applies, so the method would claim an
   *     advance is required while demanding none.
   *   - The admin leaves the toggle ON and sends a percentage of 0.
   *
   * Merging first means both are caught, and a partial update that does
   * not touch the advance fields at all is unaffected.
   */
  assertValidAdvanceConfig({
    advancePaymentRequired:
      (set.advancePaymentRequired as boolean | undefined) ??
      existing.advancePaymentRequired,
    advancePaymentPercent:
      (set.advancePaymentPercent as number | undefined) ??
      existing.advancePaymentPercent,
  });

  /* If the QR image is being replaced, fire-and-forget delete the old one. */
  if (input.qrImage && typeof input.qrImage === 'object') {
    const incoming = input.qrImage as { url?: string; fileId?: string };
    const oldFileId = (existing.qrImage as { fileId?: string } | undefined)?.fileId;
    if (oldFileId && incoming.fileId && oldFileId !== incoming.fileId) {
      void deleteImageKitFile(oldFileId);
    }
  }

  const doc = await PaymentMethod.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  return toPublicPaymentMethod(doc);
}

export async function deletePaymentMethod(id: string): Promise<PublicPaymentMethod> {
  const doc = await PaymentMethod.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Payment method not found');
  const publicDoc = toPublicPaymentMethod(doc);
  const qrFileId = (doc.qrImage as { fileId?: string } | undefined)?.fileId;
  if (qrFileId) void deleteImageKitFile(qrFileId);
  return publicDoc;
}

export async function togglePaymentMethodActive(
  id: string,
  isActive: boolean
): Promise<PublicPaymentMethod> {
  const doc = await PaymentMethod.findOneAndUpdate(
    { _id: id },
    { $set: { isActive } },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Payment method not found');
  return toPublicPaymentMethod(doc);
}
