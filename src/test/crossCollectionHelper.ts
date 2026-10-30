import type { FilterQuery } from 'mongoose';
import type { IProduct } from '../modules/product/product.interface';
import { applyCrossCollectionSearch } from '../modules/public/publicSearchResolution';

/**
 * Test-only adapter so the integration tests exercise the SAME cross-collection
 * search code path the `listPublicProducts` controller uses — no simplified
 * stand-in, no chance of the two drifting apart again.
 */
export async function applyCrossCollectionSearchForTest(
  filter: FilterQuery<IProduct>,
  searchTerm: string
): Promise<void> {
  const bag = filter as Record<string, unknown>;
  bag.$and = (bag.$and as Record<string, unknown>[] | undefined) ?? [];
  await applyCrossCollectionSearch(bag.$and as Record<string, unknown>[], searchTerm);
}