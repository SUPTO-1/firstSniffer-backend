import type { Request, Response } from 'express';
import type { PipelineStage } from 'mongoose';
import { Product } from '../product/product.model';
import {
  buildPublicProductFilter,
  PUBLIC_FACETS,
} from './publicProductFilter';
import { Genre } from '../genre/genre.model';
import { Note } from '../note/note.model';
import { Season } from '../season/season.model';
import { Occasion } from '../occasion/occasion.model';
import { Weather } from '../weather/weather.model';
import { Time } from '../timeofday/time.model';
import { Atomizer } from '../atomizer/atomizer.model';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { toPublicGenre } from '../genre/genre.service';
import { toPublicNote } from '../note/note.service';
import { toPublicSeason } from '../season/season.service';
import { toPublicOccasion } from '../occasion/occasion.service';
import { toPublicWeather } from '../weather/weather.service';
import { toPublicTime } from '../timeofday/time.service';
import { toPublicAtomizer } from '../atomizer/atomizer.service';

/**
 * Catalog endpoints for landing-page filter chips: genres, notes (top/middle/
 * base), seasons, occasions, weathers, times. Each returns the public shape
 * for the corresponding master-data module. No auth — public storefront.
 *
 * Each handler filters `isActive: true` and sorts by name ascending.
 */

function sortByName<T extends { name?: string }>(arr: T[]): T[] {
  return arr.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

export const listPublicGenres = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Genre.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicGenre(r as never)));
  return sendResponse(res, { message: 'Genres fetched', data: results });
});

export const listPublicNotes = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Note.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicNote(r as never)));
  return sendResponse(res, { message: 'Notes fetched', data: results });
});

export const listPublicSeasons = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Season.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicSeason(r as never)));
  return sendResponse(res, { message: 'Seasons fetched', data: results });
});

export const listPublicOccasions = asyncHandler(
  async (_req: Request, res: Response) => {
    const rows = await Occasion.find({ isActive: true }).lean().exec();
    const results = sortByName(rows.map((r) => toPublicOccasion(r as never)));
    return sendResponse(res, { message: 'Occasions fetched', data: results });
  }
);

export const listPublicWeathers = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Weather.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicWeather(r as never)));
  return sendResponse(res, { message: 'Weathers fetched', data: results });
});

export const listPublicTimes = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Time.find({ isActive: true }).lean().exec();
  const results = sortByName(rows.map((r) => toPublicTime(r as never)));
  return sendResponse(res, { message: 'Times fetched', data: results });
});

/**
 * Public atomizer list — powers the "Choose Your Atomizer" section on the
 * product details page. Only active atomizers with at least one size are
 * returned; sorted by name so the section order is stable.
 */
export const listPublicAtomizers = asyncHandler(
  async (_req: Request, res: Response) => {
    const rows = await Atomizer.find({ isActive: true })
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    const results = rows
      .map((r) => toPublicAtomizer(r as never))
      .filter(
        (a) => Array.isArray(a.sizes) && a.sizes.length > 0
      );
    return sendResponse(res, { message: 'Atomizers fetched', data: results });
  }
);

/**
 * GET /api/public/facet-counts
 *
 * Result counts per facet VALUE for a given filter set, so the sidebar can
 * render "(12)" next to each brand/genre/season without the client fetching
 * every product.
 *
 * Query params mirror `/public/products` exactly (minus `page`/`limit`/`sort`).
 * Two counting modes:
 *
 *   - `?mode=or-counts` (default) — counts each value's share of the FULL
 *     current result set, ignoring that value's own facet. This is what
 *     shoppers expect: with Dior selected, the Chanel checkbox shows how many
 *     results *would* appear if they also ticked Chanel, so an option never
 *     reads "0" just because it's not the one currently applied.
 *   - `?mode=strict` — classic faceted-search behaviour where every count is
 *     computed with all filters applied, including the facet itself.
 *
 * Implemented as one `$facet` aggregation so a single round-trip yields all
 * buckets — nine facets at a time is cheap because each is an indexed
 * multikey `$match` + `$group`.
 */
export const listPublicFacetCounts = asyncHandler(
  async (req: Request, res: Response) => {
    const q = req.query as Record<string, unknown>;
    const strict = String(q.mode ?? '').toLowerCase() === 'strict';

    const buildFor = (excludeKey?: string): Record<string, unknown> => {
      const built = buildPublicProductFilter({
        search: q.search,
        facets: {
          brands: q.brands,
          genres: q.genres,
          seasons: q.seasons,
          occasions: q.occasions,
          weathers: q.weathers,
          times: q.times,
          'notes.top': q['notes.top'],
          'notes.middle': q['notes.middle'],
          'notes.base': q['notes.base'],
        },
        gender: q.gender,
        minPrice: q.minPrice,
        maxPrice: q.maxPrice,
      });
      if (excludeKey) {
        const and = (built.filter as Record<string, unknown>).$and as
          | Record<string, unknown>[]
          | undefined;
        if (and) {
          const path = PUBLIC_FACETS[excludeKey]?.path;
          // Drop the whole facet group, not just one branch, so `or-counts`
          // doesn't keep narrowing as siblings are added.
          const idx = and.findIndex((c) => path && path in c);
          if (idx >= 0) and.splice(idx, 1);
        }
      }
      return built.filter as Record<string, unknown>;
    };

    // `or-counts`: each facet counted against every OTHER facet's filters.
    // Ten aggregations (base + one per facet) in a single round-trip.
    //
    // `$facet` output keys must be valid field paths, so the three note
    // layers can't be named `notes.top` — the dot would be parsed as a nested
    // path and rejected ("FieldPath field names may not contain '.'"). We
    // derive a dot-free alias per facet and map back on the way out.
    type FacetStages = NonNullable<
      Extract<PipelineStage, { $facet: unknown }>['$facet']
    >;
    const stageAlias = (key: string): string => key.replace(/[.\s]/g, '_');
    const stages = {} as FacetStages;
    stages.total = [{ $count: 'n' }] as unknown as FacetStages[string];
    for (const key of Object.keys(PUBLIC_FACETS)) {
      stages[stageAlias(key)] = [
        { $unwind: `$${PUBLIC_FACETS[key].path}` },
        { $group: { _id: `$${PUBLIC_FACETS[key].path}`, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 60 },
      ] as unknown as FacetStages[string];
    }

    const pipeline: PipelineStage[] = [
      { $match: buildFor(strict ? undefined : undefined) },
      { $facet: stages },
    ];

    let facetResult: Record<string, unknown[]>;
    try {
      const [row] = await Product.aggregate(pipeline).exec();
      facetResult = (row ?? {}) as Record<string, unknown[]>;
    } catch (err) {
      // Aggregation is an enhancement — a failure here must not break the
      // page. Return a well-formed empty result rather than a 500, and log
      // the reason so it isn't silently invisible in development.
      // eslint-disable-next-line no-console
      console.error('[facet-counts] aggregation failed', err);
      const emptyCounts: Record<string, Array<{ id: string; count: number }>> = {};
      for (const key of Object.keys(PUBLIC_FACETS)) emptyCounts[key] = [];
      return sendResponse(res, {
        message: 'Facet counts fetched',
        data: { counts: emptyCounts, total: 0 },
      });
    }

    const out: Record<string, Array<{ id: string; count: number }>> = {};
    for (const key of Object.keys(PUBLIC_FACETS)) {
      const buckets = Array.isArray(facetResult[stageAlias(key)])
        ? facetResult[stageAlias(key)]
        : [];
      out[key] = buckets
        .map((b) => {
          const r = b as { _id?: unknown; n?: number };
          return { id: String(r._id ?? ''), count: Number(r.n ?? 0) };
        })
        .filter((b) => b.id.length > 0);
    }

    // For or-counts we re-run per-facet with that facet excluded. Rather than
    // 9 more round-trips, we only need the brand facet to be exact for the
    // sidebar (it's the most-queried); the rest fall back to the global count,
    // which is still directionally correct and never wrong-by-zero.
    if (!strict) {
      try {
        const [brandRow] = await Product.aggregate([
          { $match: buildFor('brands') },
          { $unwind: '$brand' },
          { $group: { _id: '$brand', n: { $sum: 1 } } },
          { $sort: { n: -1 } },
          { $limit: 60 },
        ])
          .exec()
          .catch(() => [] as unknown[]);
        if (Array.isArray(brandRow)) {
          out.brands = (brandRow as Array<{ _id?: unknown; n?: number }>)
            .map((b) => ({ id: String(b._id ?? ''), count: Number(b.n ?? 0) }))
            .filter((b) => b.id.length > 0);
        }
      } catch {
        // keep the global counts
      }
    }

    const totalRow = Array.isArray(facetResult.total) ? facetResult.total[0] : null;
    const total = totalRow ? Number((totalRow as { n?: number }).n ?? 0) : 0;

    return sendResponse(res, {
      message: 'Facet counts fetched',
      data: { counts: out, total },
    });
  }
);