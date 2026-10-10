import { seedAdmin, type SeedResult } from './admin.seed';

/**
 * Single entry-point that runs every registered seeder.
 * New seeders (e.g. catalog categories, demo data) should be added here.
 */
export async function runSeeders(): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  results.push(await seedAdmin());
  return results;
}

export type { SeedResult };
