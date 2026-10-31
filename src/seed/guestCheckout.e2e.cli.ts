/**
 * Manual E2E verification for guest checkout.
 *
 * Exercises the full anonymous-shopper lifecycle against the LIVE
 * development database:
 *
 *   1. place an order with NO auth header and NO customer id
 *   2. confirm the response carries a public token and a guest flag
 *   3. confirm the DB rows: guest User (isGuest, null password) + the
 *      order's immutable guestInfo snapshot + a 128-bit publicToken
 *   4. confirm `createdBy` is ABSENT (never an admin)
 *   5. confirm the order shows up in the ADMIN orders list
 *   6. confirm the guest shows up in the ADMIN customers list, flagged
 *   7. fetch the order anonymously via the token
 *   8. confirm the sequential order-number route does NOT work for it
 *   9. confirm the rate limiter kicks in
 *  10. cancel the order as an admin and confirm stock is restored
 *      EXACTLY (remainingMl back to the original, totalMl unchanged)
 *
 * Run with:  npx tsx src/seed/guestCheckout.e2e.cli.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { Order } from '../modules/order/order.model';
import { User } from '../modules/user/user.model';
import { InventoryBatch } from '../modules/inventory/inventoryBatch.model';
import { InventoryLog } from '../modules/inventoryLog/inventoryLog.model';

const BASE = `http://localhost:${process.env.PORT ?? 5000}/api`;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Parse a JSON body without letting a non-JSON response break the run. */
async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  /**
   * SAFETY GUARD
   *
   * This script creates and deletes real rows. It must never be pointed
   * at a production database, so we refuse to run unless the target
   * database name is an obvious local/dev one.
   */
  const targetDb = (() => {
    try {
      return new URL(process.env.MONGODB_URI as string).pathname.replace(/^\//, '');
    } catch {
      return '';
    }
  })();
  const allowed = ['firstsniffer', 'firstsniffer_test', 'firstsniffer_dev'];
  if (targetDb && !allowed.includes(targetDb)) {
    throw new Error(
      `Refusing to run against database "${targetDb}". ` +
        `This E2E script writes and deletes rows — it only targets a local/dev database.`
    );
  }

  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log(`Connected to MongoDB (database "${targetDb || 'default'}").\n`);

  /* ---------- Fixtures ---------- */
  const Product = (await import('../modules/product/product.model')).Product;
  await Product;
  const product = await Product.findOne({ slug: 'dior-sauvage' }).exec();
  if (!product) throw new Error('Seed product dior-sauvage not found.');
  const size = '30ml';
  const variant = product.variants.find((v) => v.size === size);
  if (!variant) throw new Error('30ml variant missing.');

  // Give the product a known stock position to verify against.
  const batch = await InventoryBatch.findOne({ product: product._id }).exec();
  if (!batch) throw new Error('No inventory batch for dior-sauvage.');
  const before = {
    remainingMl: batch.remainingMl,
    totalMl: batch.totalMl,
    batchId: String(batch._id),
  };

  const guestPhone = '01700000099';
  const guestName = 'E2E Guest Shopper';
  const marker = `E2E-${Date.now()}`;

  console.log('=== 0. Clean slate for this run ===');
  await Order.deleteMany({ 'guestInfo.phone': guestPhone });
  await User.deleteMany({ phone: guestPhone, isGuest: true });
  console.log(`  batch ${before.batchId}: remainingMl=${before.remainingMl} totalMl=${before.totalMl}\n`);

  const body = {
    guestInfo: {
      name: guestName,
      phone: guestPhone,
      email: 'e2e-guest@example.com',
      label: 'Home',
      district: 'Chattogram',
      area: 'Gulshan',
      address: 'House 1, Road 1, Block A',
    },
    orderSource: 'online',
    items: [{ product: String(product._id), size, quantity: 1 }],
    shippingAddress: {
      label: 'Home',
      district: 'Chattogram',
      area: 'Chulal',
      address: 'House 12, Road 7',
    },
    paymentDetails: {
      senderMobile: '01711111111',
      transactionId: 'E2ETRX123',
    },
  };

  /* ---------- 1. Anonymous order creation ---------- */
  console.log('=== 1. POST /api/orders with NO auth header ===');
  const res = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  check('anonymous guest order accepted', res.status === 201, `status=${res.status}`);
  const order = json?.data;
  if (!order?.orderNumber) {
    console.log('  body:', JSON.stringify(json).slice(0, 500));
    throw new Error('Order was not created — aborting E2E.');
  }
  check('response orderNumber present', !!order.orderNumber, order.orderNumber);
  check('response isGuestOrder === true', order.isGuestOrder === true);
  check('response carries a publicToken', typeof order.publicToken === 'string' && order.publicToken.length === 32, order.publicToken);

  /* ---------- 2. DB rows ---------- */
  console.log('\n=== 2. Database rows ===');
  const doc = await Order.findOne({ orderNumber: order.orderNumber }).exec();
  check('order persisted', !!doc);
  check('guestInfo snapshot stored', doc?.guestInfo?.name === guestName && doc?.guestInfo?.phone === guestPhone);
  check('guestInfo address snapshotted', doc?.guestInfo?.address === body.guestInfo.address);
  check('customer links to a guest User row', !!doc?.customer);

  const guestUser = doc?.customer ? await User.findById(doc.customer).exec() : null;
  check('guest User row exists', !!guestUser);
  check('guest User isGuest === true', guestUser?.isGuest === true);
  check('guest User role === customer', guestUser?.role === 'customer');
  check('guest User password is null (cannot log in)', guestUser?.password === null || guestUser?.password === undefined, String(guestUser?.password));

  check('publicToken stored on the order', doc?.publicToken === order.publicToken);
  check('publicToken is 32 hex chars', /^[a-f0-9]{32}$/.test(doc?.publicToken ?? ''));

  check(
    'createdBy is ABSENT for a guest order (never an admin)',
    doc?.createdBy === undefined || doc?.createdBy === null,
    `createdBy=${String(doc?.createdBy)}`
  );

  check(
    'paymentDetails persisted (the checkout bug being fixed)',
    doc?.paymentDetails?.senderMobile === '01711111111' && doc?.paymentDetails?.transactionId === 'E2ETRX123',
    JSON.stringify(doc?.paymentDetails)
  );

  /* ---------- 3. Stock deduction ---------- */
  console.log('\n=== 3. Stock deduction ===');
  const afterSale = await InventoryBatch.findById(before.batchId).exec();
  check(
    `stock deducted by exactly 30ml (${before.remainingMl} -> ${afterSale?.remainingMl})`,
    afterSale?.remainingMl === before.remainingMl - 30
  );
  check('totalMl unchanged by a sale', afterSale?.totalMl === before.totalMl);

  const saleLogs = await InventoryLog.find({ type: 'sale', referenceId: String(doc?._id) }).exec();
  check('a sale inventory log was written', saleLogs.length > 0, `${saleLogs.length} log(s)`);
  check(
    'sale log has NO createdBy (no actor for a guest)',
    saleLogs.every((l) => l.createdBy === undefined || l.createdBy === null)
  );

  /* ---------- 4. Admin visibility ---------- */
  console.log('\n=== 4. Admin visibility ===');
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  // This backend issues the JWT as an HttpOnly cookie (see
  // `setAuthCookie`), not in the JSON body — so the admin calls below
  // must carry the cookie, not a bearer header.
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
  check(
    'admin login succeeded and issued an auth cookie',
    loginRes.status === 200 && !!cookieHeader,
    `status=${loginRes.status}, cookies=${setCookie.length}`
  );
  const auth: Record<string, string> = cookieHeader ? { Cookie: cookieHeader } : {};

  if (cookieHeader) {

    const adminOrders = await fetch(`${BASE}/orders?search=${encodeURIComponent(order.orderNumber)}`, {
      headers: auth,
    });
    const adminOrdersJson = await readJson(adminOrders);
    const found = (adminOrdersJson?.data?.results ?? []).find(
      (o: { orderNumber: string }) => o.orderNumber === order.orderNumber
    );
    check('guest order appears in the ADMIN orders list', !!found);
    check('admin list marks it as a guest order', found?.isGuestOrder === true);
    check('admin list shows the guest name', (found?.customer?.name ?? found?.guestInfo?.name) === guestName, String(found?.customer?.name ?? found?.guestInfo?.name));

    const adminCustomers = await fetch(`${BASE}/customers?isGuest=true&search=${encodeURIComponent(guestPhone)}`, {
      headers: auth,
    });
    const adminCustomersJson = await readJson(adminCustomers);
    const guestRows = (adminCustomersJson?.data?.results ?? []).filter(
      (c: { phone: string }) => c.phone === guestPhone
    );
    check('guest appears in the ADMIN customers list', guestRows.length >= 1, `${guestRows.length} row(s)`);
    check('admin customer row is flagged isGuest', guestRows.every((c: { isGuest?: boolean }) => c.isGuest === true));

    const adminCustAll = await fetch(`${BASE}/customers?search=${encodeURIComponent(guestPhone)}`, {
      headers: auth,
    });
    const allJson = await readJson(adminCustAll);
    const allRows = allJson?.data?.results ?? [];
    check('guest is NOT merged into a registered account', allRows.every((c: { phone: string }) => c.phone === guestPhone));

    /* ---------- 5. Anonymous token lookup ---------- */
    console.log('\n=== 5. Anonymous tracking by token ===');
    const trackRes = await fetch(`${BASE}/public/orders/track/${order.publicToken}`);
    const trackJson = await readJson(trackRes);
    check('order fetchable anonymously by token', trackRes.status === 200, `status=${trackRes.status}`);
    check('token lookup returns the right order', trackJson?.data?.orderNumber === order.orderNumber);
    check('token lookup exposes the guest snapshot', trackJson?.data?.guestInfo?.phone === guestPhone);

    const byNumber = await fetch(`${BASE}/public/orders/${encodeURIComponent(order.orderNumber)}`);
    check('sequential order-number route is refused for a token order', byNumber.status === 404, `status=${byNumber.status}`);

    const badToken = await fetch(`${BASE}/public/orders/track/not-a-token`);
    check('malformed token rejected with 400', badToken.status === 400, `status=${badToken.status}`);

    /* ---------- 6. Cancellation + stock restore ---------- */
    console.log('\n=== 6. Cancellation restores stock exactly ===');
    const cancelRes = await fetch(`${BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderStatus: 'cancelled', reason: marker }),
    });
    check('admin cancelled the guest order', cancelRes.status === 200, `status=${cancelRes.status}`);

    const restored = await InventoryBatch.findById(before.batchId).exec();
    check(
      `remainingMl restored exactly to ${before.remainingMl}`,
      restored?.remainingMl === before.remainingMl,
      `now=${restored?.remainingMl}`
    );
    check('totalMl unchanged by a cancellation', restored?.totalMl === before.totalMl, `now=${restored?.totalMl}`);

    const cancelRes2 = await fetch(`${BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderStatus: 'cancelled', reason: `${marker}-again` }),
    });
    console.log(`  (repeat cancel status=${cancelRes2.status} — idempotency guard)`);
    const restored2 = await InventoryBatch.findById(before.batchId).exec();
    check(
      'a repeated cancel does NOT double-credit stock',
      restored2?.remainingMl === before.remainingMl,
      `now=${restored2?.remainingMl}`
    );
  }

  /* ---------- 7. Rate limiting ---------- */
  console.log('\n=== 7. Rate limiting on anonymous order creation ===');
  let limited = 0;
  let accepted = 0;
  let retryAfterSeen = false;
  for (let i = 0; i < 15; i += 1) {
    const r = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 429) {
      limited += 1;
      if (r.headers.get('retry-after')) retryAfterSeen = true;
    } else if (r.status === 201) accepted += 1;
  }
  check('rate limiter rejected the flood (429 seen)', limited > 0, `${limited} x 429, ${accepted} x 201`);
  check('a 429 response carries a Retry-After header', retryAfterSeen);

  /* ---------- 8. Cleanup ---------- */
  console.log('\n=== 8. Cleanup ===');
  const placed = await Order.find({ 'guestInfo.phone': guestPhone }).exec();
  for (const o of placed) {
    if (!o.inventoryReversed) {
      // Restore any residual deduction before deleting.
      const fresh = await InventoryBatch.findById(before.batchId).exec();
      if (fresh && fresh.remainingMl < before.remainingMl) {
        await InventoryBatch.updateOne(
          { _id: before.batchId },
          { $inc: { remainingMl: before.remainingMl - fresh.remainingMl } }
        );
      }
    }
    await Order.deleteOne({ _id: o._id });
  }
  await User.deleteMany({ phone: guestPhone, isGuest: true });
  const finalBatch = await InventoryBatch.findById(before.batchId).exec();
  console.log(`  final batch remainingMl=${finalBatch?.remainingMl} totalMl=${finalBatch?.totalMl} (expected ${before.remainingMl}/${before.totalMl})`);
  check('stock returned to its starting position after cleanup', finalBatch?.remainingMl === before.remainingMl);

  await mongoose.disconnect();
  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('E2E FAILED:', err);
  process.exitCode = 1;
});
