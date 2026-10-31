/**
 * One-off migration: legacy `inventories` (per product+size) → `inventorybatches`
 * (per purchase batch), plus the product-level inventory settings that used to
 * live on the legacy row.
 *
 * WHY THIS EXISTS
 * ---------------
 * The legacy model keyed stock on the SELLING size (`bottleSize: '3ml'`), which
 * contradicts the decant business: one 100ml original bottle yields 3/5/10/15/30ml
 * decants, all drawn from the SAME pool. The new model keys stock on the PURCHASE
 * (a batch of original bottles) and aggregates at the product level.
 *
 * DESIGN RULES
 * ------------
 *  - READ-THEN-WRITE. Nothing is destructive. The legacy `inventories` collection
 *    is left untouched and archived for one release cycle.
 *  - IDEMPOTENT. Every write is guarded by a `migratedFrom` marker, so re-running
 *    the migration is a no-op rather than a duplicate insert.
 *  - NO SILENT DISCARD. Every ambiguous value is either carried forward or
 *    recorded in the migration report. Nothing is dropped without a trace.
 *  - RECONCILE. The script ends by asserting that the new collection's totals
 *    match the legacy totals, per product. A mismatch fails loudly.
 *
 * The legacy `bottleSize` value is deliberately NOT used as a capacity: it was an
 * enum of selling sizes and is meaningless as a millilitre figure. The capacity
 * comes from the seller's confirmation of the ORIGINAL bottle size.
 */

import { Inventory } from '../modules/inventory/inventory.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { InventoryLog } from '../modules/inventoryLog/inventoryLog.model';
import { Product } from '../modules/product/product.model';

/** Per-product decisions the seller confirmed before the migration ran. */
export interface ProductMigrationDecision {
  /**
   * Capacity of ONE original bottle, in true millilitres. This is the number
   * that replaces the legacy `bottleSize` (which was a selling-size enum and
   * therefore carried no capacity information).
   */
  sourceBottleSizeMl: number;
  /** How many original bottles were bought in this purchase. */
  quantity: number;
  /**
   * Total cost of the purchase in BDT. Used verbatim — NOT divided by
   * `quantity` and NOT interpreted per-ml.
   */
  purchaseCost: number;
  /**
   * Seller-owned safety margin in ml, held back from sale. Moved from the
   * legacy `reservedBufferMl` and is now ACTUALLY enforced (the legacy value
   * was stored but never subtracted from anything).
   */
  safetyBufferMl?: number;
  /** Absolute ml threshold below which the product is flagged as low stock. */
  lowStockThresholdMl?: number;
  /** Optional free-text note recorded on the migrated batch. */
  notes?: string;
}

export interface InventoryMigrationReport {
  productId: string;
  productName: string;
  legacyInventoryId: string;
  batchId: string | null;
  status: 'migrated' | 'skipped' | 'no_decision';
  legacy: {
    bottleSize: string;
    totalMl: number;
    remainingMl: number;
    reservedBufferMl: number;
    lowStockThresholdMl: number;
    purchaseCost: number;
  } | null;
  migrated: {
    sourceBottleSizeMl: number;
    quantity: number;
    totalMl: number;
    remainingMl: number;
    purchaseCost: number;
  } | null;
  logsMigrated: number;
  notes: string[];
}

export interface MigrationOutcome {
  reports: InventoryMigrationReport[];
  reconciled: boolean;
  errors: string[];
  /** How many products had their variant `isActive` flags backfilled. */
  variantsBackfilled: number;
}

/**
 * Migrate one legacy inventory row into a purchase batch.
 *
 * Returns `skipped` when a batch already carries this row's `migratedFrom`
 * marker (i.e. the migration already ran for it) — the script is re-runnable.
 */
async function migrateLegacyRow(
  legacy: {
    _id: unknown;
    product: unknown;
    productName: string;
    totalMl: number;
    remainingMl: number;
    purchaseCost: number;
    createdAt?: Date;
  },
  decision: ProductMigrationDecision,
  report: InventoryMigrationReport
): Promise<void> {
  const legacyId = String(legacy._id);
  const productId = String(legacy.product);

  // Idempotency guard — a batch already points back at this legacy row.
  const existing = await InventoryBatch.findOne({ migratedFrom: legacy._id }).lean();
  if (existing) {
    report.status = 'skipped';
    report.batchId = String(existing._id);
    report.notes.push(
      'A batch already references this legacy row — migration previously ran.'
    );
    return;
  }

  const sourceBottleSizeMl = Math.round(decision.sourceBottleSizeMl);
  const quantity = Math.round(decision.quantity);

  if (!Number.isFinite(sourceBottleSizeMl) || sourceBottleSizeMl < 1) {
    report.notes.push(
      `SKIPPED: sourceBottleSizeMl (${decision.sourceBottleSizeMl}) is invalid.`
    );
    return;
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    report.notes.push(
      `SKIPPED: quantity (${decision.quantity}) is invalid.`
    );
    return;
  }

  const totalMl = sourceBottleSizeMl * quantity;

  // The legacy `remainingMl` is authoritative for how much liquid is LEFT.
  // It must not exceed the new capacity — if it does, the two records
  // disagree and we must not silently invent a number.
  if (legacy.remainingMl > totalMl) {
    report.notes.push(
      `SKIPPED: legacy remainingMl (${legacy.remainingMl}) exceeds the new capacity (${totalMl}). ` +
        'The legacy row and the confirmed bottle size disagree — manual review required.'
    );
    return;
  }

  const batch = await InventoryBatch.create({
    product: productId,
    productName: legacy.productName,
    sourceBottleSizeMl,
    quantity,
    totalMl,
    remainingMl: legacy.remainingMl,
    purchaseCost: Math.max(0, Math.round(decision.purchaseCost)),
    purchaseDate: legacy.createdAt ?? new Date(),
    supplier: '',
    notes:
      decision.notes ??
      `Migrated from legacy inventory row ${legacyId} (legacy bottleSize "${report.legacy?.bottleSize}" was a selling-size artifact, not a capacity).`,
    isActive: true,
    migratedFrom: legacy._id,
  });

  report.status = 'migrated';
  report.batchId = String(batch._id);
  report.migrated = {
    sourceBottleSizeMl,
    quantity,
    totalMl,
    remainingMl: legacy.remainingMl,
    purchaseCost: Math.max(0, Math.round(decision.purchaseCost)),
  };
}

/**
 * Migrate the legacy log rows that referenced this inventory row.
 *
 * Legacy logs pointed at the per-size inventory row; new logs point at a
 * batch. Each legacy log is RE-POINTED in place at the batch the row became,
 * keeping its type, quantity, reference, author and timestamps.
 *
 * Re-pointing (rather than copying) matters: the log collection is
 * append-only and is the audit trail. Creating a duplicate would double-count
 * every movement in the admin log view. The legacy `inventories` collection
 * stays archived; only the log's *pointer* is rewritten, which is what
 * "retargeting the log to batches" means.
 *
 * The log's `type` enum gained 'reversal' in the new model — 'bufferRelease'
 * was a never-used admin escape hatch and is remapped to 'adjustment'.
 */
async function migrateLogs(
  legacyId: string,
  batchId: string,
  productId: string,
  report: InventoryMigrationReport
): Promise<void> {
  const logs = await InventoryLog.find({ inventory: legacyId });

  for (const log of logs) {
    const doc = log as unknown as Record<string, unknown>;
    const rawType = String(doc.type ?? 'adjustment');
    const type =
      rawType === 'bufferRelease' ? 'adjustment' : (rawType as string);

    await InventoryLog.updateOne(
      { _id: doc._id },
      { $set: { inventory: batchId, product: productId, type } }
    );

    report.logsMigrated += 1;
  }
}

/**
 * Move the legacy per-row inventory knobs onto the product, where they now
 * live. `reservedBufferMl` → `safetyBufferMl` (and it is finally enforced).
 */
async function migrateProductSettings(
  productId: string,
  decision: ProductMigrationDecision,
  legacy: { reservedBufferMl: number; lowStockThresholdMl: number },
  report: InventoryMigrationReport
): Promise<void> {
  const safetyBufferMl = Math.max(
    0,
    Math.round(decision.safetyBufferMl ?? legacy.reservedBufferMl)
  );
  const lowStockThresholdMl = Math.max(
    0,
    Math.round(decision.lowStockThresholdMl ?? legacy.lowStockThresholdMl)
  );

  await Product.updateOne(
    { _id: productId },
    { $set: { safetyBufferMl, lowStockThresholdMl } }
  );

  report.notes.push(
    `Product settings: safetyBufferMl=${safetyBufferMl} (legacy reservedBufferMl=${legacy.reservedBufferMl}), ` +
      `lowStockThresholdMl=${lowStockThresholdMl} (legacy ${legacy.lowStockThresholdMl}).`
  );
}

/**
 * Ensure every selling variant carries an explicit `isActive` flag.
 *
 * The schema default already handles new documents; this backfills any row
 * written before the field existed so a query on `isActive: true` can never
 * miss a legacy variant.
 */
async function backfillVariantFlags(): Promise<number> {
  const products = await Product.find({
    variants: { $elemMatch: { isActive: { $exists: false } } },
  }).lean();

  let touched = 0;
  for (const p of products) {
    const doc = p as unknown as {
      _id: unknown;
      variants?: Array<Record<string, unknown>>;
    };
    await Product.updateOne(
      { _id: doc._id },
      {
        $set: {
          variants: (doc.variants ?? []).map((v) => ({
            ...v,
            isActive: v.isActive === undefined ? true : v.isActive,
          })),
        },
      }
    );
    touched += 1;
  }
  return touched;
}

/**
 * Reconcile the new batch totals against the legacy row totals, per product.
 * A mismatch means the migration lost or invented stock — fail loudly.
 */
async function reconcile(): Promise<{ ok: boolean; details: string[] }> {
  const details: string[] = [];
  let ok = true;

  const legacyRows = await Inventory.find().lean();
  const legacyByProduct = new Map<string, { totalMl: number; remainingMl: number }>();
  for (const row of legacyRows) {
    const r = row as unknown as {
      product: unknown;
      totalMl: number;
      remainingMl: number;
    };
    const pid = String(r.product);
    const acc = legacyByProduct.get(pid) ?? { totalMl: 0, remainingMl: 0 };
    acc.totalMl += r.totalMl;
    acc.remainingMl += r.remainingMl;
    legacyByProduct.set(pid, acc);
  }

  const newRows = await InventoryBatch.find().lean();
  const newByProduct = new Map<string, { totalMl: number; remainingMl: number }>();
  for (const row of newRows) {
    const r = row as unknown as {
      product: unknown;
      totalMl: number;
      remainingMl: number;
    };
    const pid = String(r.product);
    const acc = newByProduct.get(pid) ?? { totalMl: 0, remainingMl: 0 };
    acc.totalMl += r.totalMl;
    acc.remainingMl += r.remainingMl;
    newByProduct.set(pid, acc);
  }

  for (const [pid, legacy] of legacyByProduct) {
    const next = newByProduct.get(pid) ?? { totalMl: 0, remainingMl: 0 };
    const totalMatch = legacy.totalMl === next.totalMl;
    const remainingMatch = legacy.remainingMl === next.remainingMl;
    if (!totalMatch || !remainingMatch) {
      ok = false;
      details.push(
        `MISMATCH product ${pid}: legacy totalMl=${legacy.totalMl}/remainingMl=${legacy.remainingMl} ` +
          `vs batch totalMl=${next.totalMl}/remainingMl=${next.remainingMl}`
      );
    } else {
      details.push(
        `OK product ${pid}: totalMl=${next.totalMl}, remainingMl=${next.remainingMl}`
      );
    }
  }

  return { ok, details };
}

/**
 * Run the migration.
 *
 * `decisions` maps a product id to the seller-confirmed reading of its legacy
 * row. A legacy row whose product has NO decision is reported as
 * `no_decision` and left untouched — the migration never guesses.
 */
export async function migrateInventoryToBatches(
  decisions: Record<string, ProductMigrationDecision>
): Promise<MigrationOutcome> {
  const reports: InventoryMigrationReport[] = [];
  const errors: string[] = [];

  const legacyRows = await Inventory.find().lean();

  for (const raw of legacyRows) {
    const legacy = raw as unknown as {
      _id: unknown;
      product: unknown;
      productName: string;
      bottleSize: string;
      totalMl: number;
      remainingMl: number;
      reservedBufferMl: number;
      lowStockThresholdMl: number;
      purchaseCost: number;
      createdAt?: Date;
    };
    const productId = String(legacy.product);

    const report: InventoryMigrationReport = {
      productId,
      productName: legacy.productName,
      legacyInventoryId: String(legacy._id),
      batchId: null,
      status: 'no_decision',
      legacy: {
        bottleSize: legacy.bottleSize,
        totalMl: legacy.totalMl,
        remainingMl: legacy.remainingMl,
        reservedBufferMl: legacy.reservedBufferMl,
        lowStockThresholdMl: legacy.lowStockThresholdMl,
        purchaseCost: legacy.purchaseCost,
      },
      migrated: null,
      logsMigrated: 0,
      notes: [
        `Legacy bottleSize "${legacy.bottleSize}" discarded as a selling-size artifact (it is not a capacity).`,
      ],
    };

    const decision = decisions[productId];
    if (!decision) {
      report.notes.push(
        'No confirmed reading for this product — the legacy row was left untouched.'
      );
      reports.push(report);
      continue;
    }

    try {
      await migrateLegacyRow(legacy, decision, report);
      if (report.status === 'migrated' && report.batchId) {
        await migrateLogs(
          report.legacyInventoryId,
          report.batchId,
          productId,
          report
        );
        await migrateProductSettings(
          productId,
          decision,
          {
            reservedBufferMl: legacy.reservedBufferMl,
            lowStockThresholdMl: legacy.lowStockThresholdMl,
          },
          report
        );
      }
    } catch (err) {
      errors.push(
        `product ${productId}: ${(err as Error)?.message ?? String(err)}`
      );
      report.status = 'skipped';
    }

    reports.push(report);
  }

  const variantsTouched = await backfillVariantFlags();

  const { ok, details } = await reconcile();

  return {
    reports,
    reconciled: ok,
    errors: [
      ...errors,
      ...(ok ? [] : details.filter((d) => d.startsWith('MISMATCH'))),
    ],
    variantsBackfilled: variantsTouched,
  };
}

/** Print a human-readable summary of a migration run. */
export function printMigrationReport(outcome: MigrationOutcome): void {
  /* eslint-disable no-console */
  console.log('\n=== Inventory migration report ===');
  for (const r of outcome.reports) {
    console.log(
      `\n[${r.status}] ${r.productName} (${r.productId})`
    );
    console.log(`  legacy: ${JSON.stringify(r.legacy)}`);
    console.log(`  batch : ${JSON.stringify(r.migrated)}`);
    console.log(`  logs migrated: ${r.logsMigrated}`);
    for (const n of r.notes) console.log(`  - ${n}`);
  }
  console.log('\n=== Reconciliation ===');
  console.log(`  reconciled: ${outcome.reconciled ? 'OK' : 'FAILED'}`);
  console.log(`  variant isActive flags backfilled on ${outcome.variantsBackfilled} product(s)`);
  if (outcome.errors.length) {
    console.log('  errors:');
    for (const e of outcome.errors) console.log(`   ! ${e}`);
  }
  console.log('');
  /* eslint-enable no-console */
}
