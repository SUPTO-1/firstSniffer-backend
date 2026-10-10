import type { Model } from 'mongoose';

/**
 * Convert a name into a URL-safe kebab-case slug.
 * - Lowercases
 * - Strips diacritics (é → e, ñ → n)
 * - Replaces non-[a-z0-9] with a single dash
 * - Trims leading/trailing dashes
 */
export function slugify(input: string): string {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

interface GenerateUniqueSlugOptions {
  /** Source name to derive a slug from (used when no baseSlug provided). */
  name?: string;
  /** Optional pre-normalised base slug to start from. */
  baseSlug?: string;
  /** When updating, exclude the current document from the uniqueness check. */
  excludeId?: unknown;
}

/**
 * Generate a slug that's unique within a Mongo collection.
 * On collision, appends `-2`, `-3`, … until it finds a free slot.
 *
 * Pass `baseSlug` when the admin has hand-typed a slug;
 * pass `name` when deriving from the name.
 */
export async function generateUniqueSlug<T>(
  Model: Model<T>,
  options: GenerateUniqueSlugOptions
): Promise<string> {
  const base =
    options.baseSlug && options.baseSlug.length > 0
      ? slugify(options.baseSlug)
      : slugify(options.name ?? '');
  if (!base) return '';

  // Build a filter that excludes the row being updated.
  const where: Record<string, unknown> = { slug: base };
  if (options.excludeId !== undefined && options.excludeId !== null) {
    where._id = { $ne: options.excludeId };
  }

  const taken = await Model.exists(where);
  if (!taken) return base;

  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    const conflict = await Model.exists({
      slug: candidate,
      ...(options.excludeId !== undefined && options.excludeId !== null
        ? { _id: { $ne: options.excludeId } }
        : {}),
    });
    if (!conflict) return candidate;
  }
  // Fallback: extremely unlikely — random suffix.
  return `${base}-${Date.now()}`;
}
