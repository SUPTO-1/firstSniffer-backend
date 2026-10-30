import { Types } from 'mongoose';
import { Brand } from '../brand/brand.model';
import { Note } from '../note/note.model';
import { Genre } from '../genre/genre.model';
import { Season } from '../season/season.model';
import { Occasion } from '../occasion/occasion.model';
import { Weather } from '../weather/weather.model';
import { Time } from '../timeofday/time.model';

/**
 * Search across `ref:`'d collections so `?search=oud` finds a product whose
 * BASE NOTE is "Oud", and `?search=chanel` matches the brand name rather than
 * requiring a denormalised `brandName` field to exist.
 *
 * Each helper issues one indexed regex query per token and returns raw
 * ObjectId strings. The caller folds them into `$in` clauses.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Taxonomy names are matched WHOLE-WORD, not as free substrings.
 *
 * A plain substring regex makes `search=oud` match "Cl**oud**y" (a weather),
 * which then returns every product tagged Cloudy — nonsense for someone
 * looking for an oud note. Anchoring each token to a word boundary
 * (`\b`) means:
 *
 *   "oud"      → matches "Oud", "Oud Wood", "Royal Oud"   ✓
 *   "oud"      → does NOT match "Cloudy", "Cloudberry"     ✓
 *   "tom ford"→ matches "Tom Ford" (two adjacent tokens)   ✓
 *
 * We accept a name when the token appears as a whole word OR as the start of
 * a word followed by more characters — i.e. `\btoken` without a trailing
 * boundary. That keeps genuine partial typing useful ("sauv" → "Sauvage")
 * while refusing matches that begin mid-word ("oud" inside "Cloudy").
 */
function tokenPatterns(tokens: string[]): RegExp[] {
  return tokens.map((t) => new RegExp(`\\b${escapeRegex(t)}`, 'i'));
}

async function findIds(
  model: typeof Note,
  tokens: string[]
): Promise<string[]> {
  if (tokens.length === 0) return [];
  try {
    const rows = await model
      .find({ isActive: true, name: { $in: tokenPatterns(tokens) } })
      .select('_id')
      .limit(200)
      .lean()
      .exec();
    return rows.map((r) => String((r as { _id: unknown })._id));
  } catch {
    // A taxonomy lookup failure must not take down search — the product-level
    // clauses still narrow the result.
    return [];
  }
}

/** Brand ids whose name/slug/aliases match any token. */
export function searchBrandIds(tokens: string[]): Promise<string[]> {
  if (tokens.length === 0) return Promise.resolve([]);
  const res = tokenPatterns(tokens);
  return Brand.find({
    isActive: true,
    $or: [
      { name: { $in: res } },
      { slug: { $in: res } },
      { aliases: { $in: res } },
    ],
  })
    .select('_id')
    .limit(200)
    .lean()
    .exec()
    .then((rows) => rows.map((r) => String((r as { _id: unknown })._id)))
    .catch(() => []);
}

export const searchNoteIds = (tokens: string[]): Promise<string[]> =>
  findIds(Note, tokens);
export const searchGenreIds = (tokens: string[]): Promise<string[]> =>
  findIds(Genre, tokens);
export const searchSeasonIds = (tokens: string[]): Promise<string[]> =>
  findIds(Season, tokens);
export const searchOccasionIds = (tokens: string[]): Promise<string[]> =>
  findIds(Occasion, tokens);
export const searchWeatherIds = (tokens: string[]): Promise<string[]> =>
  findIds(Weather, tokens);
export const searchTimeIds = (tokens: string[]): Promise<string[]> =>
  findIds(Time, tokens);

/**
 * Build the `$or` branches that let ONE search token match a product through
 * any of: its own denormalised text, its brand's name, or any of its
 * taxonomy labels.
 *
 * CRITICAL: the id sets passed in must be the ones resolved for THIS token
 * alone. Passing a combined set (ids matching token A *or* token B) makes
 * every token satisfiable by every other token's matches, which silently turns
 * "AND across tokens" into "AND over an OR of everything". `?search=oud wood`
 * would then return every Woody product even without an oud note.
 */
export async function branchesForToken(
  token: string,
  ids: {
    brandIds: string[];
    genreIds: string[];
    noteIds: string[];
    seasonIds: string[];
    occasionIds: string[];
    weatherIds: string[];
    timeIds: string[];
  }
): Promise<Record<string, unknown>[]> {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = /^[\p{L}\p{N}_]/u.test(token)
    ? new RegExp(`\\b${escaped}`, 'iu')
    : new RegExp(escaped, 'iu');
  const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

  const branches: Record<string, unknown>[] = [
    { name: re },
    { slug: re },
    { description: re },
    { aliases: { $in: [re] } },
  ];
  if (ids.brandIds.length > 0) {
    branches.push({ brand: { $in: ids.brandIds.map(oid) } });
  }
  if (ids.genreIds.length > 0) {
    branches.push({ genres: { $in: ids.genreIds.map(oid) } });
  }
  if (ids.noteIds.length > 0) {
    branches.push({
      $or: [
        { 'notes.top': { $in: ids.noteIds.map(oid) } },
        { 'notes.middle': { $in: ids.noteIds.map(oid) } },
        { 'notes.base': { $in: ids.noteIds.map(oid) } },
      ],
    });
  }
  if (ids.seasonIds.length > 0) {
    branches.push({ seasons: { $in: ids.seasonIds.map(oid) } });
  }
  if (ids.occasionIds.length > 0) {
    branches.push({ occasions: { $in: ids.occasionIds.map(oid) } });
  }
  if (ids.weatherIds.length > 0) {
    branches.push({ weathers: { $in: ids.weatherIds.map(oid) } });
  }
  if (ids.timeIds.length > 0) {
    branches.push({ times: { $in: ids.timeIds.map(oid) } });
  }
  return branches;
}

/** Resolve the taxonomy ids matching exactly ONE token. */
export function resolveTokenIds(
  token: string
): Promise<{
  brandIds: string[];
  genreIds: string[];
  noteIds: string[];
  seasonIds: string[];
  occasionIds: string[];
  weatherIds: string[];
  timeIds: string[];
}> {
  const one = [token];
  return Promise.all([
    searchBrandIds(one),
    searchGenreIds(one),
    searchNoteIds(one),
    searchSeasonIds(one),
    searchOccasionIds(one),
    searchWeatherIds(one),
    searchTimeIds(one),
  ]).then(([brandIds, genreIds, noteIds, seasonIds, occasionIds, weatherIds, timeIds]) => ({
    brandIds,
    genreIds,
    noteIds,
    seasonIds,
    occasionIds,
    weatherIds,
    timeIds,
  }));
}

/**
 * Replace the placeholder search clause in `and` with one `$or` group per
 * token, ANDed together.
 *
 * Returns `false` when the term matched nothing in the referenced
 * collections AND nothing in the product's own text — in which case the
 * caller should short-circuit to an empty result rather than returning
 * everything.
 */
export async function applyCrossCollectionSearch(
  and: Record<string, unknown>[],
  searchTerm: string
): Promise<boolean> {
  const tokens = searchTerm.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;

  // Drop the placeholder group buildPublicProductFilter pushed (it only
  // covered denormalised fields and would double-count the tokens).
  const placeholderIdx = and.findIndex(
    (c) => Object.keys(c).length === 1 && '$or' in c
  );
  if (placeholderIdx >= 0) and.splice(placeholderIdx, 1);

  let matchedAnything = false;
  for (const token of tokens) {
    const ids = await resolveTokenIds(token);
    const branches = await branchesForToken(token, ids);
    // A token with no taxonomy hits still contributes its text-match branches,
    // which is what lets `?search=sauvage` work on product name alone.
    if (
      ids.brandIds.length ||
      ids.genreIds.length ||
      ids.noteIds.length ||
      ids.seasonIds.length ||
      ids.occasionIds.length ||
      ids.weatherIds.length ||
      ids.timeIds.length
    ) {
      matchedAnything = true;
    }
    and.push({ $or: branches });
  }
  return matchedAnything;
}