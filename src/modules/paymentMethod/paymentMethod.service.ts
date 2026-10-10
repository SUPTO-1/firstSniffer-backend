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
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

export async function createPaymentMethod(
  input: Partial<IPaymentMethod>
): Promise<PublicPaymentMethod> {
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
