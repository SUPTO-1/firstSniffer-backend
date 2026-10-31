/**
 * Post-migration verification. Prints the live state of every collection the
 * migration touched, so the result can be eyeballed against the plan.
 *
 *   npx ts-node --transpile-only src/seed/verifyInventory.cli.ts
 */

import { connectDatabase, disconnectDatabase } from '../config/database';
import { Inventory } from '../modules/inventory/inventory.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { InventoryLog } from '../modules/inventoryLog/inventoryLog.model';
import { Product } from '../modules/product/product.model';
import { Order } from '../modules/order/order.model';

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const batches = await InventoryBatch.find().lean();
    const logs = await InventoryLog.find().lean();
    const products = await Product.find()
      .select('name slug variants safetyBufferMl lowStockThresholdMl')
      .lean();
    const legacy = await Inventory.find().lean();
    const orders = await Order.find().lean();

    /* eslint-disable no-console */
    console.log('\n=== inventorybatches ===');
    for (const b of batches) {
      const row = b as unknown as Record<string, unknown>;
      console.log(
        `  id=${String(row._id)} product=${String(row.product)} ` +
          `bottle=${row.sourceBottleSizeMl}ml x${row.quantity} ` +
          `total=${row.totalMl}ml remaining=${row.remainingMl}ml ` +
          `cost=BDT${row.purchaseCost} active=${row.isActive} ` +
          `migratedFrom=${row.migratedFrom ? String(row.migratedFrom) : '—'}`
      );
    }

    console.log('\n=== products (stock settings + variants) ===');
    for (const p of products) {
      const row = p as unknown as Record<string, unknown>;
      console.log(
        `  ${row.name} (${row.slug}) safetyBufferMl=${row.safetyBufferMl} ` +
          `lowStockThresholdMl=${row.lowStockThresholdMl}`
      );
      const variants = (row.variants ?? []) as Array<Record<string, unknown>>;
      for (const v of variants) {
        console.log(
          `      variant size=${v.size} price=${v.price} isActive=${v.isActive}`
        );
      }
    }

    console.log('\n=== inventorylogs (batch-level) ===');
    for (const l of logs) {
      const row = l as unknown as Record<string, unknown>;
      console.log(
        `  type=${row.type} quantityMl=${row.quantityMl} batch=${String(row.inventory)} ` +
          `product=${String(row.product)} note="${row.note ?? ''}"`
      );
    }

    console.log('\n=== legacy inventories (archived, read-only) ===');
    for (const i of legacy) {
      const row = i as unknown as Record<string, unknown>;
      console.log(
        `  id=${String(row._id)} bottleSize=${row.bottleSize} totalMl=${row.totalMl} ` +
          `remainingMl=${row.remainingMl} purchaseCost=${row.purchaseCost}`
      );
    }

    console.log(`\n  orders=${orders.length}`);
    console.log('');
    /* eslint-enable no-console */
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('[verify] failed:', err);
  /* eslint-enable no-console */
  process.exit(1);
});
