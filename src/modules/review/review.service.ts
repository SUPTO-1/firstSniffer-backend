import { ApiError } from '../../utils/ApiError';
import { Review } from './review.model';
import { Product } from '../product/product.model';
import { User } from '../user/user.model';
import { deleteImageKitFile } from '../imagekit/imagekit.service';
import { pickWritable } from '../_shared/pickWritable';
import { executePagedQuery, type PagedResult } from '../../utils/queryBuilder';
import {
  REVIEW_QUERY_CONFIG,
  type IReview,
  type PublicReview,
  type ReviewDoc,
  type ReviewStatus,
} from './review.interface';

const WRITABLE_REVIEW_KEYS = [
  'rating',
  'title',
  'comment',
  'images',
  'status',
  'isActive',
] as const;

export async function toPublicReview(doc: ReviewDoc | null): Promise<PublicReview> {
  if (!doc) throw ApiError.notFound('Review not found');
  const raw = doc as unknown as Record<string, unknown> & { _id?: unknown };

  const product = await Product.findById(doc.product)
    .select('name slug')
    .lean()
    .exec();
  const customer = await User.findById(doc.customer)
    .select('name')
    .lean()
    .exec();

  return {
    id: raw._id ? String(raw._id) : '',
    product: {
      id: String(doc.product),
      name: (product as { name?: string } | undefined)?.name ?? '',
      slug: (product as { slug?: string } | undefined)?.slug ?? '',
    },
    customer: {
      id: String(doc.customer),
      name: (customer as { name?: string } | undefined)?.name ?? '',
    },
    rating: (raw.rating as number) ?? 0,
    title: (raw.title as string) ?? '',
    comment: (raw.comment as string) ?? '',
    images: ((raw.images as PublicReview['images']) ?? []).filter(
      (i) => i && (i.url || i.fileId)
    ),
    status: raw.status as ReviewStatus,
    isActive: raw.isActive !== false,
    createdAt: raw.createdAt ? new Date(raw.createdAt as Date).toISOString() : undefined,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt as Date).toISOString() : undefined,
  };
}

export async function createReview(input: Partial<IReview>): Promise<PublicReview> {
  try {
    const doc = await Review.create({
      ...input,
      status: input.status ?? 'pending',
    });
    return toPublicReview(doc);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 11000
    ) {
      throw ApiError.badRequest('This customer has already reviewed this product');
    }
    throw err;
  }
}

export function listReviews(
  queryStr: Record<string, unknown>
): Promise<PagedResult<IReview>> {
  return executePagedQuery<IReview>(
    Review as unknown as import('mongoose').Model<IReview>,
    queryStr,
    REVIEW_QUERY_CONFIG
  );
}

export async function getReviewById(id: string): Promise<PublicReview> {
  const doc = await Review.findById(id);
  return toPublicReview(doc);
}

export async function updateReview(
  id: string,
  input: Partial<IReview>
): Promise<PublicReview> {
  const existing = await Review.findById(id);
  if (!existing) throw ApiError.notFound('Review not found');

  const set = pickWritable(
    input as Record<string, unknown>,
    WRITABLE_REVIEW_KEYS
  );

  /* If images are replaced, fire-and-forget delete the old ones. */
  if (Array.isArray(input.images)) {
    const oldIds = (existing.images ?? [])
      .map((i) => (i as { fileId?: string }).fileId)
      .filter((x): x is string => !!x);
    const incomingIds = new Set(
      input.images
        .map((i) => i.fileId)
        .filter((x): x is string => !!x)
    );
    for (const oldId of oldIds) {
      if (!incomingIds.has(oldId)) void deleteImageKitFile(oldId);
    }
  }

  const doc = await Review.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Review not found');

  /* If status was changed by hand, recompute averages either way. */
  await recomputeProductRating(String(existing.product));
  return toPublicReview(doc);
}

export async function setReviewStatus(
  id: string,
  status: ReviewStatus
): Promise<PublicReview> {
  const existing = await Review.findById(id);
  if (!existing) throw ApiError.notFound('Review not found');

  const doc = await Review.findOneAndUpdate(
    { _id: id },
    { $set: { status } },
    { new: true, runValidators: true, context: 'query' }
  );
  if (!doc) throw ApiError.notFound('Review not found');

  await recomputeProductRating(String(existing.product));
  return toPublicReview(doc);
}

export async function approveReview(id: string): Promise<PublicReview> {
  return setReviewStatus(id, 'approved');
}

export async function rejectReview(id: string): Promise<PublicReview> {
  return setReviewStatus(id, 'rejected');
}

export async function deleteReview(id: string): Promise<PublicReview> {
  const doc = await Review.findByIdAndDelete(id);
  if (!doc) throw ApiError.notFound('Review not found');
  /* Best-effort cleanup of any ImageKit files attached to the review. */
  for (const img of doc.images ?? []) {
    const fileId = (img as { fileId?: string }).fileId;
    if (fileId) void deleteImageKitFile(fileId);
  }
  await recomputeProductRating(String(doc.product));
  return toPublicReview(doc);
}

/**
 * Aggregate approved reviews for a product and rewrite `averageRating` +
 * `reviewCount` on the parent Product. Idempotent — safe to call after
 * approve/reject/delete.
 */
async function recomputeProductRating(productId: string): Promise<void> {
  const stats = await Review.aggregate<{
    _id: null;
    avg: number | null;
    n: number;
  }>([
    { $match: { product: productId, status: 'approved', isActive: true } },
    { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
  ]);
  const row = stats[0];
  await Product.findByIdAndUpdate(productId, {
    $set: {
      averageRating: row && row.n > 0 ? Number((row.avg ?? 0).toFixed(2)) : 0,
      reviewCount: row?.n ?? 0,
    },
  });
}