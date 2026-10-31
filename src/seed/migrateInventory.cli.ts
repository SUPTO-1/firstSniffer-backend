/**
 * CLI entrypoint for the one-off inventory migration.
 *
 *   npx tsx src/seed/migrateInventory.cli.ts            # dry run (report only)
 *   npx tsx src/seed/migrateInventory.cli.ts --apply    # perform the writes
 *
 * The migration is idempotent — re-running it with `--apply` after a
 * successful run reports `skipped` for every row and writes nothing.
 */

import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  migrateInventoryToBatches,
  printMigrationReport,
  type ProductMigrationDecision,
} from './inventoryMigration';
import { Inventory } from '../modules/inventory/inventory.model';
import { Product } from '../modules/product/product.model';

/**
 * Seller-confirmed readings, keyed by product id.
 *
 * These came from an explicit confirmation before the migration was run:
 *   "original bottle 100ml and total cost total purchase cost ৳15,000"
 *
 * The legacy `bottleSize` was NOT used as a capacity — it was an enum of
 * selling sizes (3/5/10/15/30ml) and carried no capacity information.
 */
const DECISIONS: Record<string, ProductMigrationDecision> = {
  '6adcbfa8b6fcaedf91077481': {
    sourceBottleSizeMl: 100,
    quantity: 1,
    purchaseCost: 15000,
    safetyBufferMl: 10,
    lowStockThresholdMl: 30,
    notes:
      'Original 100ml bottle. Legacy bottleSize "3ml" was a selling-size artifact and is not a capacity.',
  },
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  /* eslint-disable no-console */
  console.log(
    `[migrate] mode: ${apply ? 'APPLY' : 'DRY RUN (no writes — re-run with --apply)'}`
  );
  /* eslint-enable no-console */

  await connectDatabase();

  try {
    // Preflight: report what is about to happen so a dry run is meaningful.
    const legacyCount = await Inventory.countDocuments();
    const productCount = await Product.countDocuments();
    /* eslint-disable no-console */
    console.log(
      `[migrate] legacy inventory rows: ${legacyCount}, products: ${productCount}`
    );
    /* eslint-enable no-console */

    if (!apply) {
      const rows = await Inventory.find().lean();
      for (const raw of rows) {
        const r = raw as unknown as {
          _id: unknown;
          product: unknown;
          productName: string;
          bottleSize: string;
          totalMl: number;
          remainingMl: number;
          reservedBufferMl: number;
          lowStockThresholdMl: number;
          purchaseCost: number;
        };
        const decision = DECISIONS[String(r.product)];
        /* eslint-disable no-console */
        console.log(
          `[migrate] ${r.productName} (${r.product})\n` +
            `           legacy: bottleSize=${r.bottleSize} totalMl=${r.totalMl} remainingMl=${r.remainingMl} ` +
            `reservedBufferMl=${r.reservedBufferMl} lowStockThresholdMl=${r.lowStockThresholdMl} purchaseCost=${r.purchaseCost}\n` +
            `           decision: ${
              decision
                ? `sourceBottleSizeMl=${decision.sourceBottleSizeMl} quantity=${decision.quantity} purchaseCost=${decision.purchaseCost}`
                : 'NONE — this row will be left untouched'
            }`
        );
        /* eslint-enable no-console */
      }
      return;
    }

    const outcome = await migrateInventoryToBatches(DECISIONS);
    printMigrationReport(outcome);

    if (!outcome.reconciled) {
      /* eslint-disable no-console */
      console.error(
        '[migrate] FAILED — reconciliation did not balance. The legacy collection is untouched; investigate before serving traffic.'
      );
      /* eslint-enable no-console */
      process.exitCode = 1;
      return;
    }

    /* eslint-disable no-console */
    console.log(
      '[migrate] DONE — the legacy `inventories` collection is left in place as a read-only archive.'
    );
    /* eslint-enable no-console */
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('[migrate] failed:', err);
  /* eslint-enable no-console */
  process.exit(1);
});
