import { ApiError } from '../../utils/ApiError';
import { Order } from './order.model';
import { OrderReview } from './orderReview.model';
import { OrderPayment } from './orderPayment.model';
import type { PublicOrderReview } from './orderReview.interface';
import type { PublicOrderPayment } from './orderPayment.interface';
import { Combo } from '../combo/combo.model';
import { Coupon } from '../coupon/coupon.model';
import { Inventory } from '../inventory/inventory.model';
import { Product } from '../product/product.model';
import { Settings } from '../settings/settings.model';
import { User } from '../user/user.model';
import { recordSaleMl, adjustInventoryMl } from '../inventory/inventory.service';
import {
  buildMongooseQuery,
  executePagedQuery,
  type PagedResult,
} from '../../utils/queryBuilder';
import {
  ORDER_QUERY_CONFIG,
  ORDER_STATUS_TRANSITIONS,
  type IOrder,
  type OrderDoc,
  type OrderStatus,
  type PaymentStatus,
  type PublicOrder,
  type PublicOrderCombo,
  type PublicOrderItem,
} from './order.interface';
import type {
  IOrderReview,
  OrderReviewDoc,
} from './orderReview.interface';
import type {
  IOrderPayment,
  OrderPaymentDoc,
} from './orderPayment.interface';
import type { ShippingZoneId } from '../_shared/validation';
import { pickWritable } from '../_shared/pickWritable';
import type { IAddress, PublicUser } from '../user/user.interface';

const WRITABLE_ORDER_KEYS = [
  'shippingAddress',
  'notes',
  'paymentMethod',
] as const;

/* ------------------------------------------------------------------
 *  Mapping helpers
 * ------------------------------------------------------------------ */

function mapItem(doc: OrderDoc['items'][number]): PublicOrderItem {
  return {
    product: {
      id: String((doc.product as unknown as { toString(): string }).toString()),
      name: doc.productSnapshot?.name ?? '',
      slug: doc.productSnapshot?.slug ?? '',
      image: doc.productSnapshot?.image,
    },
    size: doc.size,
    millilitres: doc.millilitres,
    unitPricePerMl: doc.unitPricePerMl,
    totalPrice: doc.totalPrice,
  };
}

function mapCombo(doc: OrderDoc['combos'][number]): PublicOrderCombo {
  return {
    combo: {
      id: String((doc.combo as unknown as { toString(): string }).toString()),
      name: doc.name,
      slug: doc.slug,
    },
    quantity: doc.quantity,
    unitPrice: doc.unitPrice,
    totalPrice: doc.totalPrice,
    components: doc.components.map((c) => ({
      product: String((c.product as unknown as { toString(): string }).toString()),
      size: c.size,
      ml: c.ml,
    })),
  };
}

export async function toPublicOrder(doc: OrderDoc | null): Promise<PublicOrder> {
  if (!doc) throw ApiError.notFound('Order not found');

  const customer = await User.findById(doc.customer)
    .select('name phone email role isGuest addresses isActive')
    .lean()
    .exec();
  const createdBy = await User.findById(doc.createdBy)
    .select('name')
    .lean()
    .exec();
  const paymentMethod = doc.paymentMethod
    ? await (async (): Promise<PublicOrder['paymentMethod']> => {
        try {
          const mod = await import('../paymentMethod/paymentMethod.service');
          return await mod.getPaymentMethodById(String(doc.paymentMethod));
        } catch {
          return null;
        }
      })()
    : null;

  const fallbackCustomer: PublicUser = {
    id: String(doc.customer),
    name: '',
    phone: null,
    email: null,
    role: 'customer',
    isGuest: false,
    addresses: [],
    isActive: true,
  };

  const publicCustomer: PublicUser = customer
    ? {
        id: String(customer._id),
        name: (customer as { name?: string }).name ?? '',
        phone: (customer as { phone?: string | null }).phone ?? null,
        email: (customer as { email?: string | null }).email ?? null,
        role: 'customer',
        isGuest: Boolean((customer as { isGuest?: boolean }).isGuest),
        addresses: ((customer as { addresses?: IAddress[] }).addresses ?? []),
        isActive: (customer as { isActive?: boolean }).isActive !== false,
      }
    : fallbackCustomer;

  return {
    id: String(doc._id),
    orderNumber: doc.orderNumber,
    invoiceNumber: doc.invoiceNumber ?? undefined,
    customer: publicCustomer,
    orderSource: doc.orderSource,
    items: doc.items.map(mapItem),
    combos: doc.combos.map(mapCombo),
    subtotal: doc.subtotal,
    discount: doc.discount,
    couponCode: doc.couponCode ?? null,
    shippingCharge: doc.shippingCharge,
    total: doc.total,
    paidAmount: doc.paidAmount ?? 0,
    paymentMethod: paymentMethod ?? null,
    paymentStatus: doc.paymentStatus,
    orderStatus: doc.orderStatus,
    shippingAddress: doc.shippingAddress,
    notes: doc.notes,
    inventoryReversed: doc.inventoryReversed,
    createdBy: createdBy
      ? { id: String(createdBy._id), name: (createdBy as { name?: string }).name ?? '' }
      : { id: String(doc.createdBy), name: '' },
    createdAt: doc.createdAt?.toISOString?.(),
    updatedAt: doc.updatedAt?.toISOString?.(),
  };
}

/* ------------------------------------------------------------------
 *  Listing
 * ------------------------------------------------------------------ */

export async function listOrders(
  queryStr: Record<string, unknown>
): Promise<PagedResult<PublicOrder>> {
  const built = buildMongooseQuery<IOrder>(queryStr, ORDER_QUERY_CONFIG);
  const [rows, total] = await Promise.all([
    Order.find(built.filter)
      .sort(built.sort)
      .skip(built.skip)
      .limit(built.limit)
      .populate('customer', 'name phone email role')
      .populate('paymentMethod')
      .lean()
      .exec(),
    Order.countDocuments(built.filter).exec(),
  ]);
  const results = await Promise.all(
    (rows as unknown as OrderDoc[]).map((r) => toPublicOrder(r))
  );
  return {
    results,
    page: built.page,
    limit: built.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / built.limit),
  };
}

export async function getOrderById(id: string): Promise<PublicOrder> {
  const doc = (await Order.findById(id)
    .populate('customer', 'name phone email role')
    .populate('paymentMethod')
    .lean()
    .exec()) as OrderDoc | null;
  return toPublicOrder(doc);
}

/**
 * Public lookup by human-readable order number (e.g. `FS-2026-000001`).
 * No auth — used by the storefront `/order-confirmed/[orderNumber]` page so a
 * freshly-placed order is visible without an admin token. The order number
 * itself is high-entropy and treated as a capability.
 */
export async function getOrderByNumber(orderNumber: string): Promise<PublicOrder> {
  const trimmed = orderNumber.trim();
  if (!trimmed) throw ApiError.badRequest('Order number is required');
  const doc = (await Order.findOne({ orderNumber: trimmed })
    .populate('customer', 'name phone email role')
    .populate('paymentMethod')
    .lean()
    .exec()) as OrderDoc | null;
  return toPublicOrder(doc);
}

/* ------------------------------------------------------------------
 *  Calculate — pure function, no DB writes.
 * ------------------------------------------------------------------ */

export interface CalculateInput {
  items: { product: string; size: '3ml' | '5ml' | '10ml' | '30ml'; millilitres: number }[];
  combos?: { combo: string; quantity: number }[];
  shippingZone: ShippingZoneId;
  couponCode?: string;
}

export interface CalculateOutput {
  subtotal: number;
  discount: number;
  shippingCharge: number;
  total: number;
  freeShippingApplied: boolean;
  items: (PublicOrderItem & { availableMl: number; inStock: boolean })[];
  combos: (PublicOrderCombo & { inStock: boolean })[];
  coupon?: { code: string; discount: number; applied: boolean; reason?: string };
}

export async function calculateOrder(input: CalculateInput): Promise<CalculateOutput> {
  const settings = await Settings.findById('global').lean().exec();
  const inside = settings?.insideCtgCharge ?? 60;
  const outside = settings?.outsideCtgCharge ?? 120;
  const freeThreshold = settings?.freeShippingThreshold ?? 0;
  const shippingBase = input.shippingZone === 'inside-ctg' ? inside : outside;

  /* ----- Resolve items ----- */
  const productIds = input.items.map((i) => i.product);
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } })
        .select('name slug images variants')
        .lean()
        .exec()
    : [];
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const inventory = productIds.length
    ? await Inventory.find({ product: { $in: productIds } })
        .select('product bottleSize remainingMl')
        .lean()
        .exec()
    : [];
  const inventoryKey = (pid: string, size: string) => `${pid}::${size}`;
  const invByKey = new Map(
    inventory.map((i) => [
      inventoryKey(
        String((i as { product: { toString(): string } }).product),
        (i as { bottleSize: string }).bottleSize
      ),
      (i as { remainingMl: number }).remainingMl,
    ])
  );

  const resolvedItems: (PublicOrderItem & {
    availableMl: number;
    inStock: boolean;
  })[] = [];
  let subtotal = 0;

  for (const line of input.items) {
    const product = productById.get(line.product);
    if (!product) {
      throw ApiError.badRequest(`Unknown product: ${line.product}`);
    }
    const variant = product.variants.find((v) => v.size === line.size);
    if (!variant) {
      throw ApiError.badRequest(
        `Product ${product.name} has no ${line.size} variant`
      );
    }
    if (variant.price <= 0) {
      throw ApiError.badRequest(`${product.name} (${line.size}) is not sellable`);
    }
    const available = invByKey.get(inventoryKey(line.product, line.size)) ?? 0;
    const inStock = available >= line.millilitres;
    const totalPrice = variant.price * line.millilitres;
    subtotal += totalPrice;
    resolvedItems.push({
      product: {
        id: line.product,
        name: product.name,
        slug: product.slug,
        image: product.images?.[0],
      },
      size: line.size,
      millilitres: line.millilitres,
      unitPricePerMl: variant.price,
      totalPrice,
      availableMl: available,
      inStock,
    });
  }

  /* ----- Resolve combos ----- */
  const resolvedCombos: (PublicOrderCombo & { inStock: boolean })[] = [];
  if (input.combos && input.combos.length) {
    const comboIds = input.combos.map((c) => c.combo);
    const combos = await Combo.find({ _id: { $in: comboIds } })
      .select('name slug comboPrice products isActive')
      .lean()
      .exec();
    const comboById = new Map(combos.map((c) => [String(c._id), c]));

    for (const cl of input.combos) {
      const combo = comboById.get(cl.combo);
      if (!combo) {
        throw ApiError.badRequest(`Unknown combo: ${cl.combo}`);
      }
      if (!combo.isActive) {
        throw ApiError.badRequest(`Combo ${combo.name} is inactive`);
      }
      const totalPrice = combo.comboPrice * cl.quantity;
      subtotal += totalPrice;
      let allInStock = true;
      for (const comp of combo.products) {
        const product = productById.get(String(comp.product));
        const variant = product?.variants.find((v) => v.size === comp.size);
        const available = invByKey.get(
          inventoryKey(String(comp.product), comp.size)
        );
        if (!product || !variant || (available ?? 0) < comp.millilitres * cl.quantity) {
          allInStock = false;
        }
      }
      resolvedCombos.push({
        combo: { id: cl.combo, name: combo.name, slug: combo.slug },
        quantity: cl.quantity,
        unitPrice: combo.comboPrice,
        totalPrice,
        components: combo.products.map((c) => ({
          product: String((c.product as unknown as { toString(): string }).toString()),
          size: c.size,
          ml: c.millilitres,
        })),
        inStock: allInStock,
      });
    }
  }

  /* ----- Coupon preview (non-mutating) ----- */
  let discount = 0;
  let coupon: CalculateOutput['coupon'];
  if (input.couponCode) {
    const preview = await previewCoupon(input.couponCode, subtotal);
    if (preview.applied) {
      discount = preview.discount;
    }
    coupon = {
      code: input.couponCode,
      applied: preview.applied,
      discount: preview.discount,
      reason: preview.reason,
    };
  }

  /* ----- Shipping ----- */
  let shippingCharge = shippingBase;
  let freeShippingApplied = false;
  if (freeThreshold > 0 && subtotal - discount >= freeThreshold) {
    shippingCharge = 0;
    freeShippingApplied = true;
  }

  const total = Math.max(0, subtotal - discount + shippingCharge);

  return {
    subtotal,
    discount,
    shippingCharge,
    total,
    freeShippingApplied,
    items: resolvedItems,
    combos: resolvedCombos,
    coupon,
  };
}

/* ------------------------------------------------------------------
 *  Coupon helpers
 * ------------------------------------------------------------------ */

interface CouponPreview {
  applied: boolean;
  discount: number;
  reason?: string;
}

async function previewCoupon(
  code: string,
  subtotal: number
): Promise<CouponPreview> {
  const coupon = await Coupon.findOne({ code: code.toUpperCase() })
    .select('isActive expiresAt usageLimit usedCount type value minPurchase maxDiscount')
    .lean()
    .exec();
  if (!coupon) return { applied: false, discount: 0, reason: 'Coupon not found' };
  if (!coupon.isActive) return { applied: false, discount: 0, reason: 'Coupon is inactive' };
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
    return { applied: false, discount: 0, reason: 'Coupon has expired' };
  }
  if (coupon.usedCount >= coupon.usageLimit) {
    return { applied: false, discount: 0, reason: 'Coupon limit reached' };
  }
  if (subtotal < coupon.minPurchase) {
    return {
      applied: false,
      discount: 0,
      reason: `Minimum purchase ৳${coupon.minPurchase}`,
    };
  }
  let discount = coupon.type === 'fixed' ? coupon.value : (coupon.value / 100) * subtotal;
  if (coupon.type === 'percentage' && coupon.maxDiscount && discount > coupon.maxDiscount) {
    discount = coupon.maxDiscount;
  }
  discount = Math.min(Math.floor(discount), subtotal);
  return { applied: true, discount };
}

/* ------------------------------------------------------------------
 *  Create — orchestrator: validate → price → deduct inventory → mint
 *  order number → reserve coupon → save.
 * ------------------------------------------------------------------ */

export async function createOrder(
  input: {
    customer: string;
    orderSource: 'online' | 'manual';
    items: { product: string; size: '3ml' | '5ml' | '10ml' | '30ml'; millilitres: number }[];
    combos?: { combo: string; quantity: number }[];
    shippingAddress: { label?: string; district: string; area: string; address: string };
    paymentMethod?: string;
    couponCode?: string;
    notes?: string;
  },
  actorId: string
): Promise<PublicOrder> {
  /* (1) Re-validate with calculate() to lock in prices */
  const settings = await Settings.findById('global').lean().exec();
  const inside = settings?.insideCtgCharge ?? 60;
  const outside = settings?.outsideCtgCharge ?? 120;
  const shippingZone: ShippingZoneId =
    (input.shippingAddress.district ?? '').toLowerCase().includes('chattogram') ||
    (input.shippingAddress.district ?? '').toLowerCase().includes('chattagram') ||
    (input.shippingAddress.area ?? '').toLowerCase().includes('ctg')
      ? 'inside-ctg'
      : 'outside-ctg';
  const calc = await calculateOrder({
    items: input.items,
    combos: input.combos,
    shippingZone,
    couponCode: input.couponCode,
  });

  if (calc.items.some((i) => !i.inStock)) {
    throw ApiError.badRequest('One or more items are out of stock');
  }
  if (calc.combos.some((c) => !c.inStock)) {
    throw ApiError.badRequest('One or more combos are out of stock');
  }

  const shippingCharge =
    shippingZone === 'inside-ctg' ? inside : outside;

  /* (2) Inventory deduction — atomic per line. We compute the future
   *     order id BEFORE deducting so the log row's referenceId is
   *     accurate. Mongo's _id is generated on the client; use the
   *     pre-generated id (mongoose uses ObjectId by default). */
  const futureOrderId = new (await import('mongoose')).Types.ObjectId().toString();

  const builtItems: PublicOrder['items'] = [];
  for (const resolved of calc.items) {
    const inv = await Inventory.findOne({
      product: resolved.product.id,
      bottleSize: resolved.size,
    })
      .select('_id product')
      .lean()
      .exec();
    if (!inv) {
      throw ApiError.badRequest(
        `No inventory for ${resolved.product.name} (${resolved.size})`
      );
    }
    await recordSaleMl(
      String((inv as { _id: unknown })._id),
      resolved.millilitres,
      futureOrderId,
      `Order line — ${resolved.product.name} (${resolved.size})`,
      actorId
    );
    builtItems.push({
      product: resolved.product,
      size: resolved.size,
      millilitres: resolved.millilitres,
      unitPricePerMl: resolved.unitPricePerMl,
      totalPrice: resolved.totalPrice,
    });
  }

  /* (3) Combo expansion — each component deducts from its own inventory */
  const builtCombos: PublicOrder['combos'] = [];
  if (input.combos && input.combos.length) {
    const combosById = new Map(
      (
        await Combo.find({ _id: { $in: input.combos.map((c) => c.combo) } })
          .select('name slug comboPrice products')
          .lean()
          .exec()
      ).map((c) => [String(c._id), c])
    );

    for (const cl of input.combos) {
      const combo = combosById.get(cl.combo);
      if (!combo) throw ApiError.badRequest(`Unknown combo: ${cl.combo}`);
      for (const comp of combo.products) {
        const inv = await Inventory.findOne({
          product: comp.product,
          bottleSize: comp.size,
        })
          .select('_id')
          .lean()
          .exec();
        if (!inv) {
          throw ApiError.badRequest(
            `No inventory for combo component (${comp.size})`
          );
        }
        await recordSaleMl(
          String((inv as { _id: unknown })._id),
          (comp.millilitres as number) * cl.quantity,
          futureOrderId,
          `Combo line — ${combo.name} (${comp.size})`,
          actorId
        );
      }
      builtCombos.push({
        combo: { id: cl.combo, name: combo.name, slug: combo.slug },
        quantity: cl.quantity,
        unitPrice: combo.comboPrice,
        totalPrice: combo.comboPrice * cl.quantity,
        components: combo.products.map((c) => ({
          product: String((c.product as unknown as { toString(): string }).toString()),
          size: c.size,
          ml: c.millilitres,
        })),
      });
    }
  }

  /* (4) Reserve coupon atomically. Look up the row first so we know
   *     its `usageLimit`, then perform the conditional $inc with the
   *     real `$lt: usageLimit` guard. Two callers racing for the last
   *     slot can both pass the lookup but only one will match the
   *     guard — the loser gets null and we 400. */
  let couponRef: string | null = null;
  if (input.couponCode && calc.coupon?.applied && calc.discount > 0) {
    const lookup = await Coupon.findOne({
      code: input.couponCode.toUpperCase(),
      isActive: true,
    })
      .select('_id usageLimit')
      .lean()
      .exec();
    if (!lookup) {
      throw ApiError.badRequest('Coupon not available');
    }
    const updated = await Coupon.findOneAndUpdate(
      {
        _id: lookup._id,
        usedCount: { $lt: lookup.usageLimit },
      },
      { $inc: { usedCount: 1 } },
      { new: true }
    );
    if (!updated) {
      throw ApiError.badRequest('Coupon limit reached');
    }
    couponRef = String(updated._id);
  }

  /* (5) Persist the order. The pre-validate hook fills orderNumber +
   *     invoiceNumber if missing. */
  const created = await Order.create({
    _id: futureOrderId,
    customer: input.customer,
    orderSource: input.orderSource,
    items: builtItems.map((item) => ({
      product: item.product.id,
      size: item.size,
      millilitres: item.millilitres,
      unitPricePerMl: item.unitPricePerMl,
      totalPrice: item.totalPrice,
      productSnapshot: {
        name: item.product.name,
        slug: item.product.slug,
        image: item.product.image ?? { url: '', fileId: '' },
      },
    })),
    combos: builtCombos.map((c) => ({
      combo: c.combo.id,
      name: c.combo.name,
      slug: c.combo.slug,
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      totalPrice: c.totalPrice,
      components: c.components,
    })),
    subtotal: calc.subtotal,
    discount: calc.discount,
    couponCode: input.couponCode?.toUpperCase() ?? null,
    couponRef,
    shippingCharge,
    total: calc.total,
    paidAmount: 0,
    paymentMethod: input.paymentMethod ?? null,
    paymentStatus: 'unpaid',
    orderStatus: 'pending',
    shippingAddress: input.shippingAddress,
    notes: input.notes ?? '',
    createdBy: actorId,
  });

  return toPublicOrder(created as unknown as OrderDoc);
}

/* ------------------------------------------------------------------
 *  Status transitions
 * ------------------------------------------------------------------ */

export async function updateOrderStatus(
  id: string,
  next: OrderStatus,
  actorId: string,
  reason?: string
): Promise<PublicOrder> {
  const doc = (await Order.findById(id).lean().exec()) as OrderDoc | null;
  if (!doc) throw ApiError.notFound('Order not found');

  const allowed = ORDER_STATUS_TRANSITIONS[doc.orderStatus] ?? [];
  if (!allowed.includes(next)) {
    throw ApiError.badRequest(
      `Cannot transition order from ${doc.orderStatus} to ${next}`
    );
  }

  /* Reverse inventory on transitions to cancelled / returned — exactly once. */
  if ((next === 'cancelled' || next === 'returned') && !doc.inventoryReversed) {
    for (const item of doc.items) {
      const inv = await Inventory.findOne({
        product: item.product,
        bottleSize: item.size,
      })
        .select('_id')
        .lean()
        .exec();
      if (!inv) continue; // inventory may have been deleted
      await adjustInventoryMl(
        String((inv as { _id: unknown })._id),
        item.millilitres,
        `Reversed order ${doc.orderNumber} (${next})${reason ? ` — ${reason}` : ''}`,
        actorId
      );
    }
    for (const combo of doc.combos) {
      for (const comp of combo.components) {
        const inv = await Inventory.findOne({
          product: comp.product,
          bottleSize: comp.size,
        })
          .select('_id')
          .lean()
          .exec();
        if (!inv) continue;
        await adjustInventoryMl(
          String((inv as { _id: unknown })._id),
          comp.ml * combo.quantity,
          `Reversed combo ${combo.name} (${next}) — order ${doc.orderNumber}`,
          actorId
        );
      }
    }
    await Order.updateOne({ _id: id }, { $set: { inventoryReversed: true } });
  }

  const updated = (await Order.findOneAndUpdate(
    { _id: id },
    { $set: { orderStatus: next } },
    { new: true, runValidators: true }
  )
    .lean()
    .exec()) as OrderDoc | null;
  return toPublicOrder(updated);
}

export async function updatePaymentStatus(
  id: string,
  paymentStatus: PaymentStatus
): Promise<PublicOrder> {
  const existing = (await Order.findById(id).lean().exec()) as OrderDoc | null;
  if (!existing) throw ApiError.notFound('Order not found');

  // When admin manually flips to 'paid', snapshot paidAmount = total
  // (so the invoice shows fully paid). For any other transition we
  // leave paidAmount alone — partial payments survive the status flip.
  const set: Record<string, unknown> = { paymentStatus };
  if (paymentStatus === 'paid' && existing.paymentStatus !== 'paid') {
    set.paidAmount = existing.total;
  }

  const updated = (await Order.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true }
  )
    .lean()
    .exec()) as OrderDoc | null;
  if (!updated) throw ApiError.notFound('Order not found');
  return toPublicOrder(updated);
}

export async function cancelOrder(
  id: string,
  actorId: string,
  reason?: string
): Promise<PublicOrder> {
  return updateOrderStatus(id, 'cancelled', actorId, reason);
}

export async function updateOrderDetails(
  id: string,
  input: Record<string, unknown>
): Promise<PublicOrder> {
  const set = pickWritable(input, WRITABLE_ORDER_KEYS);
  if (Object.keys(set).length === 0) return getOrderById(id);
  const updated = (await Order.findOneAndUpdate(
    { _id: id },
    { $set: set },
    { new: true, runValidators: true, context: 'query' }
  )
    .lean()
    .exec()) as OrderDoc | null;
  if (!updated) throw ApiError.notFound('Order not found');
  return toPublicOrder(updated);
}

/* ------------------------------------------------------------------
 *  Manual reviews (admin-only, multiple per order)
 * ------------------------------------------------------------------ */

export async function listOrderReviews(orderId: string): Promise<PublicOrderReview[]> {
  const order = await Order.exists({ _id: orderId });
  if (!order) throw ApiError.notFound('Order not found');
  const docs = (await OrderReview.find({ orderId })
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as (IOrderReview & { _id: unknown; createdBy: unknown; createdAt?: Date; updatedAt?: Date })[];
  if (docs.length === 0) return [];
  const userIds = Array.from(
    new Set(docs.map((d) => String(d.createdBy)))
  );
  const users = await User.find({ _id: { $in: userIds } })
    .select('name')
    .lean()
    .exec();
  const nameById = new Map(
    users.map((u) => [String(u._id), (u as { name?: string }).name ?? ''])
  );
  return docs.map((d) => ({
    id: String(d._id),
    orderId: String(d.orderId),
    image:
      d.image?.url && d.image?.fileId
        ? { url: d.image.url, fileId: d.image.fileId }
        : undefined,
    comment: d.comment && d.comment.length > 0 ? d.comment : undefined,
    createdBy: { id: String(d.createdBy), name: nameById.get(String(d.createdBy)) ?? '' },
    createdAt: d.createdAt?.toISOString?.(),
    updatedAt: d.updatedAt?.toISOString?.(),
  }));
}

export async function createOrderReview(
  orderId: string,
  body: { image?: { url: string; fileId: string }; comment?: string },
  actorId: string
): Promise<PublicOrderReview> {
  const order = await Order.exists({ _id: orderId });
  if (!order) throw ApiError.notFound('Order not found');

  const hasImage = !!(body.image?.url && body.image?.fileId);
  const hasComment = !!(body.comment && body.comment.trim().length > 0);
  if (!hasImage && !hasComment) {
    throw ApiError.badRequest('At least one of image or comment is required');
  }

  const created = await OrderReview.create({
    orderId,
    image: hasImage ? { url: body.image!.url, fileId: body.image!.fileId } : undefined,
    comment: hasComment ? body.comment!.trim() : '',
    createdBy: actorId,
  });

  const actor = await User.findById(actorId).select('name').lean().exec();
  const populated = created as unknown as OrderReviewDoc;
  return {
    id: String(populated._id),
    orderId: String(populated.orderId),
    image:
      populated.image?.url && populated.image?.fileId
        ? { url: populated.image.url, fileId: populated.image.fileId }
        : undefined,
    comment:
      populated.comment && populated.comment.length > 0
        ? populated.comment
        : undefined,
    createdBy: {
      id: String(populated.createdBy),
      name: (actor as { name?: string } | null)?.name ?? '',
    },
    createdAt: populated.createdAt?.toISOString?.(),
    updatedAt: populated.updatedAt?.toISOString?.(),
  };
}

/* ------------------------------------------------------------------
 *  Manual payments (admin-only, multiple per order)
 * ------------------------------------------------------------------ */

export async function listOrderPayments(
  orderId: string
): Promise<PublicOrderPayment[]> {
  const order = await Order.exists({ _id: orderId });
  if (!order) throw ApiError.notFound('Order not found');
  const docs = (await OrderPayment.find({ orderId })
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as (IOrderPayment & { _id: unknown; createdBy: unknown; createdAt?: Date; updatedAt?: Date })[];
  if (docs.length === 0) return [];
  const userIds = Array.from(
    new Set(docs.map((d) => String(d.createdBy)))
  );
  const users = await User.find({ _id: { $in: userIds } })
    .select('name')
    .lean()
    .exec();
  const nameById = new Map(
    users.map((u) => [String(u._id), (u as { name?: string }).name ?? ''])
  );
  return docs.map((d) => ({
    id: String(d._id),
    orderId: String(d.orderId),
    amount: d.amount,
    note: d.note && d.note.length > 0 ? d.note : undefined,
    createdBy: {
      id: String(d.createdBy),
      name: nameById.get(String(d.createdBy)) ?? '',
    },
    createdAt: d.createdAt?.toISOString?.(),
    updatedAt: d.updatedAt?.toISOString?.(),
  }));
}

export interface RecordOrderPaymentResult {
  payment: PublicOrderPayment;
  order: PublicOrder;
}

export async function recordOrderPayment(
  orderId: string,
  body: { amount: number; note?: string },
  actorId: string
): Promise<RecordOrderPaymentResult> {
  const order = await Order.findById(orderId).exec();
  if (!order) throw ApiError.notFound('Order not found');

  const amount = Math.floor(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('Amount must be a positive whole number');
  }

  const created = await OrderPayment.create({
    orderId,
    amount,
    note: body.note && body.note.trim().length > 0 ? body.note.trim() : '',
    createdBy: actorId,
  });

  // Recompute paidAmount from the payment log (not from the order's
  // previous paidAmount — that way deletes/refunds via future
  // tooling stay consistent).
  const sumAgg = await OrderPayment.aggregate<{ _id: null; total: number }>([
    { $match: { orderId: order._id } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]).exec();
  const paidAmount = sumAgg[0]?.total ?? 0;

  // Auto-flip payment status.
  let nextStatus: PaymentStatus = order.paymentStatus;
  if (paidAmount >= order.total) {
    nextStatus = 'paid';
  } else if (paidAmount > 0 && order.paymentStatus === 'unpaid') {
    nextStatus = 'pending_verification';
  }

  const updated = (await Order.findOneAndUpdate(
    { _id: orderId },
    { $set: { paidAmount, paymentStatus: nextStatus } },
    { new: true }
  )
    .lean()
    .exec()) as OrderDoc | null;
  if (!updated) throw ApiError.notFound('Order not found');

  const actor = await User.findById(actorId).select('name').lean().exec();
  const populated = created as unknown as OrderPaymentDoc;
  const payment: PublicOrderPayment = {
    id: String(populated._id),
    orderId: String(populated.orderId),
    amount: populated.amount,
    note:
      populated.note && populated.note.length > 0 ? populated.note : undefined,
    createdBy: {
      id: String(populated.createdBy),
      name: (actor as { name?: string } | null)?.name ?? '',
    },
    createdAt: populated.createdAt?.toISOString?.(),
    updatedAt: populated.updatedAt?.toISOString?.(),
  };

  return { payment, order: await toPublicOrder(updated) };
}

/* ------------------------------------------------------------------
 *  Internal — hydrated doc lookups (used by the invoice endpoint).
 * ------------------------------------------------------------------ */

export async function getOrderDocById(id: string): Promise<OrderDoc> {
  const doc = (await Order.findById(id)
    .populate('customer', 'name phone email')
    .populate('paymentMethod')
    .lean()
    .exec()) as OrderDoc | null;
  if (!doc) throw ApiError.notFound('Order not found');
  return doc;
}

export async function getOrderDocByNumber(
  orderNumber: string
): Promise<OrderDoc> {
  const trimmed = orderNumber.trim();
  if (!trimmed) throw ApiError.badRequest('Order number is required');
  const doc = (await Order.findOne({ orderNumber: trimmed })
    .populate('customer', 'name phone email')
    .populate('paymentMethod')
    .lean()
    .exec()) as OrderDoc | null;
  if (!doc) throw ApiError.notFound('Order not found');
  return doc;
}

export async function listOrderPaymentsForOrderDoc(
  orderId: string
): Promise<PublicOrderPayment[]> {
  const docs = (await OrderPayment.find({ orderId })
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as (IOrderPayment & { _id: unknown; createdBy: unknown; createdAt?: Date; updatedAt?: Date })[];
  if (docs.length === 0) return [];
  const userIds = Array.from(
    new Set(docs.map((d) => String(d.createdBy)))
  );
  const users = await User.find({ _id: { $in: userIds } })
    .select('name')
    .lean()
    .exec();
  const nameById = new Map(
    users.map((u) => [String(u._id), (u as { name?: string }).name ?? ''])
  );
  return docs.map((d) => ({
    id: String(d._id),
    orderId: String(d.orderId),
    amount: d.amount,
    note: d.note && d.note.length > 0 ? d.note : undefined,
    createdBy: {
      id: String(d.createdBy),
      name: nameById.get(String(d.createdBy)) ?? '',
    },
    createdAt: d.createdAt?.toISOString?.(),
    updatedAt: d.updatedAt?.toISOString?.(),
  }));
}
