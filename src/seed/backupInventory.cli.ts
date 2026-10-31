/**
 * Pre-migration backup. Dumps the collections the inventory migration touches
 * to JSON so the operation is reversible and auditable.
 *
 *   npx ts-node --transpile-only src/seed/backupInventory.cli.ts
 */

import fs from 'fs';
import path from 'path';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Inventory } from '../modules/inventory/inventory.model';
import { InventoryLog } from '../modules/inventoryLog/inventoryLog.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { Product } from '../modules/product/product.model';
import { Order } from '../modules/order/order.model';

const OUT_DIR = path.resolve(process.cwd(), 'backups');

async function main(): Promise<void> {
  await connectDatabase();

  try {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshot = {
      takenAt: new Date().toISOString(),
      inventories: await Inventory.find().lean(),
      inventorylogs: await InventoryLog.find().lean(),
      inventorybatches: await InventoryBatch.find().lean(),
      products: await Product.find().lean(),
      orders: await Order.find().lean(),
    };

    const file = path.join(OUT_DIR, `inventory-pre-migration-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8');

    /* eslint-disable no-console */
    console.log(`[backup] written: ${file}`);
    console.log(
      `[backup] counts: inventories=${snapshot.inventories.length} ` +
        `inventorylogs=${snapshot.inventorylogs.length} ` +
        `inventorybatches=${snapshot.inventorybatches.length} ` +
        `products=${snapshot.products.length} orders=${snapshot.orders.length}`
    );
    /* eslint-enable no-console */
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('[backup] failed:', err);
  /* eslint-enable no-console */
  process.exit(1);
});
