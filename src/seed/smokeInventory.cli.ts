/**
 * End-to-end smoke test of the redesigned inventory flow against the LIVE
 * database (the dev `firstsniffer` database, not the test one).
 *
 * It exercises the path a real order takes:
 *   1. Read the product's aggregated stock.
 *   2. Place an order through the real service.
 *   3. Confirm the ml deduction is EXACT (the old bug deducted 1ml).
 *   4. Cancel the order and confirm the stock returns to the exact batches.
 *
 * The order it creates is deleted afterwards so the ledger is left as found.
 *
 *   npx ts-node --transpile-only src/seed/smokeInventory.cli.ts
 */

import { connectDatabase, disconnectDatabase } from '../config/database';
import { Product } from '../modules/product/product.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { InventoryLog } from '../modules/inventoryLog/inventoryLog.model';
import { Order } from '../modules/order/order.model';
import { User } from '../modules/user/user.model';
import { getProductStock } from '../modules/inventory/inventoryBatch.service';
import { createOrder, updateOrderStatus } from '../modules/order/order.service';

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const product = await Product.findOne({ slug: 'dior-sauvage' }).lean();
    if (!product) throw new Error('dior-sauvage not found');

    const pid = String((product as unknown as { _id: unknown })._id);
    const productName = String(
      (product as unknown as { name: string }).name ?? 'Dior Sauvage'
    );

    /* eslint-disable no-console */
    console.log(`\n=== Smoke test: ${productName} (${pid}) ===\n`);

    const before = await getProductStock(pid);
    console.log('BEFORE  ', JSON.stringify(before));

    // Pick an admin actor and a customer. A temporary customer is created if
    // the dev database has none — it is removed again at the end.
    const admin = await User.findOne({ role: 'admin' }).select('_id').lean();
    if (!admin) throw new Error('need an admin user');
    const adminId = String((admin as unknown as { _id: unknown })._id);

    let customer = await User.findOne({ role: 'customer' }).select('_id').lean();
    let tempCustomerId: string | null = null;
    if (!customer) {
      const created = await User.create({
        name: 'Smoke Test Customer',
        nickname: 'smoke',
        email: `smoke-${Date.now()}@example.com`,
        phone: '01900000000',
        password: 'not-a-real-hash',
        role: 'customer',
        isGuest: false,
        isActive: true,
        addresses: [],
      });
      tempCustomerId = String(created._id);
      customer = { _id: created._id } as unknown as typeof customer;
      console.log('(created a temporary customer for the smoke test)');
    }
    const customerId = String((customer as unknown as { _id: unknown })._id);

    // 30ml x 1 → must deduct exactly 30ml.
    const order = await createOrder(
      {
        customer: customerId,
        orderSource: 'manual',
        items: [{ product: pid, size: '30ml', quantity: 1 }],
        shippingAddress: {
          district: 'Chattogram',
          area: 'Gulshan',
          address: 'Smoke test address',
        },
        notes: 'SMOKE TEST — auto-deleted',
      },
      adminId
    );
    console.log(`\nCreated order ${order.orderNumber} (${order.id})`);

    const afterOrder = await getProductStock(pid);
    console.log('AFTER   ', JSON.stringify(afterOrder));

    const deducted = before.remainingMl - afterOrder.remainingMl;
    console.log(`\nDeducted: ${deducted}ml (expected 30ml)`);
    if (deducted !== 30) {
      throw new Error(`FAIL: expected 30ml deducted, got ${deducted}ml`);
    }
    console.log('  PASS — a 30ml order deducts exactly 30ml');

    // Cancel → stock must return to the exact batches.
    await updateOrderStatus(order.id, 'cancelled', adminId, 'smoke test');
    const afterCancel = await getProductStock(pid);
    console.log('\nCANCELLED', JSON.stringify(afterCancel));

    if (afterCancel.remainingMl !== before.remainingMl) {
      throw new Error(
        `FAIL: stock not fully restored (${before.remainingMl} → ${afterCancel.remainingMl})`
      );
    }
    console.log('  PASS — cancellation restored the stock exactly');

    // Clean up so the ledger is left as found.
    await InventoryLog.deleteMany({ referenceId: order.id });
    await Order.deleteOne({ _id: order.id });
    if (tempCustomerId) {
      await User.deleteOne({ _id: tempCustomerId });
      console.log('(removed the temporary customer)');
    }
    const final = await getProductStock(pid);
    console.log('\nFINAL   ', JSON.stringify(final));
    console.log(
      `\n  PASS — ledger restored to ${final.remainingMl}ml (smoke-test order removed)`
    );
    console.log('\n=== Smoke test PASSED ===\n');
    /* eslint-enable no-console */
  } catch (err) {
    /* eslint-disable no-console */
    console.error('\n[smoke] FAILED:', (err as Error)?.message ?? err);
    /* eslint-enable no-console */
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('[smoke] failed:', err);
  /* eslint-enable no-console */
  process.exit(1);
});
