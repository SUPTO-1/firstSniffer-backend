import { ApiError } from '../../utils/ApiError';
import { Combo } from './combo.model';
import { getProductStockForProducts } from '../inventory/inventoryBatch.service';
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

/**
 * Validates that every combo component has enough sellable stock.
 *
 * Under the batch model a product has ONE shared ml pool — every selling
 * size draws from it — so the check is PRODUCT-level, not per-size.
 * We no longer require an inventory row keyed by (product, size); that
 * model could not express "one 100ml bottle feeds 3/5/10/15/30ml".
 *
 * `ml` on a combo component is the volume the combo consumes of that
 * product. We check the component's own ml (the combo's stock need) plus
 * the total ml of every component sharing the same product, because they
 * all draw from the same pool.
 */
async function assertInventoryRows(
  products: { product: unknown; size: string; ml?: number; millilitres?: number }[]
): Promise<void> {
  if (!products.length) return;

  const productIds = Array.from(
    new Set(products.map((p) => String(p.product)))
  );

  const stockByProduct = await getProductStockForProducts(productIds);

  // Total ml each product must supply across ALL its components.
  const requiredByProduct = new Map<string, number>();
  for (const p of products) {
    const id = String(p.product);
    const ml = Number(p.ml ?? p.millilitres ?? 0);
    requiredByProduct.set(id, (requiredByProduct.get(id) ?? 0) + ml);
  }

  for (const [productId, requiredMl] of requiredByProduct.entries()) {
    const sellable = stockByProduct.get(productId)?.sellableMl ?? 0;
    if (requiredMl <= 0) continue;
    if (sellable < requiredMl) {
      const productName =
        stockByProduct.get(productId)?.productName || productId;
      throw ApiError.badRequest(
        `Combo component ${productName} needs ${requiredMl}ml but only ${sellable}ml is sellable.`
      );
    }
  }
}

export { toPublicComboFromUnknown };