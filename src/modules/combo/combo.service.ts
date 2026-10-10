import { ApiError } from '../../utils/ApiError';
import { Combo } from './combo.model';
import { Inventory } from '../inventory/inventory.model';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import {
  buildMongooseQuery,
  executePagedQuery,
  type PagedResult,
} from '../../utils/queryBuilder';
import {
  COMBO_QUERY_CONFIG,
  type ComboDoc,
  type ICombo,
  type PublicCombo,
} from './combo.interface';

const WRITABLE_COMBO_KEYS = [
  'name',
  'slug',
  'products',
  'comboPrice',
  'image',
  'isActive',
] as const;

export function toPublicCombo(doc: ComboDoc | null): PublicCombo {
  if (!doc) throw ApiError.notFound('Combo not found');
  const raw = doc as unknown as Record<string, unknown> & {
    _id?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
  };
  const img = raw.image as { url?: string; fileId?: string } | undefined;
  const image = img && (img.url || img.fileId)
    ? { url: img.url ?? '', fileId: img.fileId ?? '' }
    : null;
  return {
    id: raw._id ? String(raw._id) : '',
    name: (raw.name as string) ?? '',
    slug: (raw.slug as string) ?? '',
    products: ((raw.products as PublicCombo['products']) ?? []).map((c) => ({
      product: String(
        (c as unknown as { product: { toString(): string } }).product
      ),
      size: (c as unknown as { size: PublicCombo['products'][number]['size'] }).size,
      ml: (c as unknown as { ml: number }).ml ?? (c as unknown as { millilitres: number }).millilitres,
    })),
    comboPrice: (raw.comboPrice as number) ?? 0,
    image,
    isActive: raw.isActive !== false,
    createdAt: raw.createdAt?.toISOString?.(),
    updatedAt: raw.updatedAt?.toISOString?.(),
  };
}

function toPublicComboFromUnknown(doc: unknown): PublicCombo {
  return toPublicCombo(doc as ComboDoc);
}

export async function createCombo(input: Partial<ICombo>): Promise<PublicCombo> {
  await assertInventoryRows(input.products ?? []);
  const doc = await Combo.create(input);
  return toPublicCombo(doc);
}

export function listCombos(
  queryStr: Record<string, unknown>
): Promise<PagedResult<ICombo>> {
  return executePagedQuery<ICombo>(
    Combo as unknown as import('mongoose').Model<ICombo>,
    queryStr,
    COMBO_QUERY_CONFIG
  );
}

export async function getComboById(id: string): Promise<PublicCombo> {
  const doc = await Combo.findById(id);
  return toPublicCombo(doc);
}

export async function updateCombo(
  id: string,
  input: Partial<ICombo>
): Promise<PublicCombo> {
  const existing = await Combo.findById(id);
  if (!existing) throw ApiError.notFound('Combo not found');
  if (input.products) await assertInventoryRows(input.products);

  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_COMBO_KEYS
  );

  if (input.image && typeof input.image === 'object') {
    const incoming = input.image as { url?: string; fileId?: string };
    const oldFileId = (existing.image as { fileId?: string } | undefined)?.fileId;
    if (oldFileId && incoming.fileId && oldFileId !== incoming.fileId) {
      void deleteImageKitFile(oldFileId);
    }
  }

  const doc = await Combo.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  return toPublicCombo(doc);
}

export async function deleteCombo(id: string): Promise<PublicCombo> {
  const doc = await Combo.findOneAndDelete({ _id: id });
  if (!doc) throw ApiError.notFound('Combo not found');
  const publicDoc = toPublicCombo(doc);
  const fileId = (doc.image as { fileId?: string } | undefined)?.fileId;
  if (fileId) void deleteImageKitFile(fileId);
  return publicDoc;
}

export async function toggleComboActive(
  id: string,
  isActive: boolean
): Promise<PublicCombo> {
  const doc = await Combo.findOneAndUpdate(
    { _id: id },
    { $set: { isActive } },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Combo not found');
  return toPublicCombo(doc);
}

async function assertInventoryRows(
  products: { product: unknown; size: string }[]
): Promise<void> {
  for (const p of products) {
    const exists = await Inventory.findOne({
      product: p.product,
      bottleSize: p.size,
    })
      .select('_id')
      .lean()
      .exec();
    if (!exists) {
      throw ApiError.badRequest(
        `No inventory row exists for component (${p.size}). Create inventory first.`
      );
    }
  }
}

export { toPublicComboFromUnknown };