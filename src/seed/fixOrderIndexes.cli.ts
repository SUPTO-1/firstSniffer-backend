/**
 * One-off index repair.
 *
 * The `orders.idempotencyKey` index was created as `{ unique: true, sparse: true }`
 * while the field ALSO had `default: null`. MongoDB's sparse index only skips
 * documents where the field is ABSENT — documents storing an explicit `null`
 * are still indexed, so two keyless orders collide on `idempotencyKey: null`.
 *
 * The schema no longer defaults the field to `null`, so the index must be
 * rebuilt to match: drop the old one and let Mongoose recreate it (or create
 * it explicitly).
 *
 *   npx ts-node --transpile-only src/seed/fixOrderIndexes.cli.ts
 */

import { connectDatabase, disconnectDatabase } from '../config/database';
import { Order } from '../modules/order/order.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { InventoryLog } from '../modules/inventoryLog/inventoryLog.model';

async function main(): Promise<void> {
  await connectDatabase();
  try {
    /* eslint-disable no-console */
    console.log('[index] orders indexes BEFORE:');
    for (const ix of await Order.collection.indexes()) {
      console.log(`  ${ix.name}: ${JSON.stringify(ix.key)} unique=${ix.unique} sparse=${ix.sparse}`);
    }

    // Drop the legacy idempotency index so it can be recreated cleanly.
    const existing = await Order.collection.indexes();
    const hasIdem = existing.some((ix) => ix.name === 'idempotencyKey_1');
    if (hasIdem) {
      await Order.collection.dropIndex('idempotencyKey_1');
      console.log('[index] dropped idempotencyKey_1');
    }

    await Order.collection.createIndex(
      { idempotencyKey: 1 },
      { unique: true, sparse: true, name: 'idempotencyKey_1' }
    );
    console.log('[index] created idempotencyKey_1 (unique, sparse)');

    console.log('[index] orders indexes AFTER:');
    for (const ix of await Order.collection.indexes()) {
      console.log(`  ${ix.name}: ${JSON.stringify(ix.key)} unique=${ix.unique} sparse=${ix.sparse}`);
    }

    // Ensure the new collections' indexes exist on the live database too.
    await InventoryBatch.syncIndexes();
    await InventoryLog.syncIndexes();
    console.log('[index] inventorybatches + inventorylogs indexes synced');

    console.log('\n[index] inventorybatches indexes:');
    for (const ix of await InventoryBatch.collection.indexes()) {
      console.log(`  ${ix.name}: ${JSON.stringify(ix.key)} unique=${ix.unique}`);
    }
    console.log('\n[index] inventorylogs indexes:');
    for (const ix of await InventoryLog.collection.indexes()) {
      console.log(`  ${ix.name}: ${JSON.stringify(ix.key)} unique=${ix.unique}`);
    }
    /* eslint-enable no-console */
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('[index] failed:', err);
  /* eslint-enable no-console */
  process.exit(1);
});
