import { ApiError } from '../../utils/ApiError';
import { Order } from './order.model';
import { OrderReview } from './orderReview.model';
import { OrderPayment } from './orderPayment.model';
import type { PublicOrderReview } from './orderReview.interface';
import type { PublicOrderPayment } from './orderPayment.interface';
import { Combo } from '../combo/combo.model';
import { Coupon } from '../coupon/coupon.model';
import { Product } from '../product/product.model';
import { Settings } from '../settings/settings.model';
import { User } from '../user/user.model';
import { PaymentMethod } from '../paymentMethod/paymentMethod.model';
import {
  consumeFifo,
  getProductStockForProducts,
  restoreAllocations,
  rollbackConsumption,
} from '../inventory/inventoryBatch.service';
import type { StockAllocation } from '../inventory/inventoryBatch.interface';
import {
  buildMongooseQuery,
  executePagedQuery,
  type PagedResult,
} from '../../utils/queryBuilder';
import {
  ORDER_QUERY_CONFIG,
  ORDER_STATUS_TRANSITIONS,
  type IOrder,
  type IGuestInfo,
  type IPaymentSnapshot,
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
import type { ShippingZoneId, ProductSize } from '../_shared/validation';
import { sizeInMl } from '../_shared/validation';
import { generatePublicToken } from '../_shared/publicToken';
import { findOrCreateGuestUser } from './guest.service';
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
    quantity: doc.quantity ?? 1,
    millilitres: doc.millilitres,
    unitPrice: doc.unitPrice,
    totalPrice: doc.totalPrice,
    stockAllocations: (doc.stockAllocations ?? []).map((a) => ({
      batch: String((a.batch as unknown as { toString(): string }).toString()),
      millilitres: a.millilitres,
    })),
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
      stockAllocations: (c.stockAllocations ?? []).map((a) => ({
        batch: String((a.batch as unknown as { toString(): string }).toString()),
        millilitres: a.millilitres,
      })),
    })),
  };
}

export async function toPublicOrder(doc: OrderDoc | null): Promise<PublicOrder> {
  if (!doc) throw ApiError.notFound('Order not found');

  const customer = doc.customer
    ? await User.findById(doc.customer)
        .select('name phone email role isGuest addresses isActive')
        .lean()
        .exec()
    : null;
  const createdBy = doc.createdBy
    ? await User.findById(doc.createdBy)
        .select('name')
        .lean()
        .exec()
    : null;
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

  /**
   * Fallback customer — used when the order has no customer account at
   * all (a guest order whose guest user row was removed).
   *
   * For a GUEST order we synthesise the public customer from the order's
   * own `guestInfo` snapshot so the storefront receipt and the admin order
   * detail dialog still show a name and phone. The snapshot is the
   * authoritative record; the `User` row is only a convenience for
   * searching and metrics.
   */
  const fallbackCustomer: PublicUser = {
    id: String(doc.customer ?? ''),
    name: doc.guestInfo?.name ?? '',
    phone: doc.guestInfo?.phone ?? null,
    email: doc.guestInfo?.email ?? null,
    role: 'customer',
    isGuest: Boolean(doc.guestInfo),
    addresses: [],
    isActive: true,
    emailVerified: true,
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
        emailVerified:
          (customer as { emailVerified?: boolean }).emailVerified !== false,
      }
    : fallbackCustomer;

  return {
    id: String(doc._id),
    orderNumber: doc.orderNumber,
    invoiceNumber: doc.invoiceNumber ?? undefined,
    customer: publicCustomer,
    guestInfo: doc.guestInfo ?? null,
    isGuestOrder: Boolean(doc.guestInfo),
    publicToken: doc.publicToken ?? null,
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
    paymentDetails: doc.paymentDetails
      ? {
          senderMobile: doc.paymentDetails.senderMobile,
          transactionId: doc.paymentDetails.transactionId,
        }
      : null,
    /**
     * The frozen payment terms. Consumers (admin dialog, storefront
     * receipt, the confirmation email) read THIS — never the live
     * PaymentMethod config — so a later config edit cannot rewrite an
     * existing order.
     */
    paymentSnapshot: doc.paymentSnapshot
      ? {
          methodName: doc.paymentSnapshot.methodName ?? '',
          methodType: doc.paymentSnapshot.methodType ?? '',
          advanceRequired: doc.paymentSnapshot.advanceRequired === true,
          advancePercent: doc.paymentSnapshot.advancePercent ?? 0,
          advanceAmount: doc.paymentSnapshot.advanceAmount ?? 0,
          remainingOnDelivery: doc.paymentSnapshot.remainingOnDelivery ?? 0,
          totalAmount: doc.paymentSnapshot.totalAmount ?? doc.total,
          accountNumber: doc.paymentSnapshot.accountNumber ?? '',
          accountName: doc.paymentSnapshot.accountName ?? '',
          instructions: doc.paymentSnapshot.instructions ?? [],
        }
      : null,
    inventoryReversed: doc.inventoryReversed,
    /**
     * The authenticated actor that created the order. A guest order has
     * NO actor — we report it as such rather than borrowing an admin id,
     * which would misrepresent who placed the order.
     */
    createdBy: createdBy
      ? { id: String(createdBy._id), name: (createdBy as { name?: string }).name ?? '' }
      : doc.createdBy
        ? { id: String(doc.createdBy), name: '' }
        : { id: '', name: 'Guest checkout' },
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
 *
 * NOTE: this is a WEAKER capability than the token lookup — the order
 * number is sequential and therefore guessable. The public controller
 * refuses to serve orders that have a `publicToken`; this function is the
 * raw lookup underneath it.
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

/**
 * Public lookup by secure token — the SAFE anonymous capability.
 *
 * The token is 128 bits of entropy from `crypto.randomBytes(16)`, so it
 * cannot be guessed or enumerated. The storefront order-confirmation
 * page uses this route.
 */
export async function getOrderByToken(token: string): Promise<PublicOrder> {
  const trimmed = String(token ?? '').trim().toLowerCase();
  if (!trimmed) throw ApiError.badRequest('Tracking token is required');
  const doc = (await Order.findOne({ publicToken: trimmed })
    .populate('customer', 'name phone email role')
    .populate('paymentMethod')
    .lean()
    .exec()) as OrderDoc | null;
  if (!doc) throw ApiError.notFound('Order not found');
  return toPublicOrder(doc);
}

/** Raw document lookup by secure token — used by the public invoice route. */
export async function getOrderDocByToken(token: string): Promise<OrderDoc> {
  const trimmed = String(token ?? '').trim().toLowerCase();
  if (!trimmed) throw ApiError.badRequest('Tracking token is required');
  const doc = (await Order.findOne({ publicToken: trimmed })
    .populate('customer', 'name phone email role isGuest')
    .populate('paymentMethod')
    .lean()
    .exec()) as OrderDoc | null;
  if (!doc) throw ApiError.notFound('Order not found');
  return doc;
}

/* ------------------------------------------------------------------
 *  Calculate — pure function, no DB writes.
 * ------------------------------------------------------------------ */

export interface CalculateInput {
  items: { product: string; size: ProductSize; quantity: number }[];
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

  /**
   * Product-level stock. A product has ONE shared ml pool — every selling
   * size draws from it. `sellableMl` is the remaining liquid minus the
   * product's safety buffer.
   */
  const stockByProduct = await getProductStockForProducts(productIds);

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
    // A disabled variant is not sellable — the admin turned this size off.
    if (variant.isActive === false) {
      throw ApiError.badRequest(
        `${product.name} (${line.size}) is not available for sale`
      );
    }
    if (variant.price <= 0) {
      throw ApiError.badRequest(`${product.name} (${line.size}) is not sellable`);
    }

    const quantity = Math.max(1, Math.round(Number(line.quantity) || 1));
    // Millilitres are DERIVED from the size — the client cannot ask for an
    // inconsistent amount. One 30ml bottle consumes 30ml of the pool.
    const millilitres = sizeInMl(line.size) * quantity;

    const available = stockByProduct.get(line.product)?.sellableMl ?? 0;
    const inStock = available >= millilitres;
    const totalPrice = variant.price * quantity;
    subtotal += totalPrice;
    resolvedItems.push({
      product: {
        id: line.product,
        name: product.name,
        slug: product.slug,
        image: product.images?.[0],
      },
      size: line.size,
      quantity,
      millilitres,
      unitPrice: variant.price,
      totalPrice,
      stockAllocations: [],
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

    // Combo components reference products that may not be in `items`, so
    // pull their stock too.
    const comboComponentProductIds = Array.from(
      new Set(
        combos.flatMap((c) =>
          (c.products as Array<{ product: unknown }>).map((p) =>
            String(p.product)
          )
        )
      )
    );
    const comboStock =
      comboComponentProductIds.length > 0
        ? await getProductStockForProducts(comboComponentProductIds)
        : new Map();

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
        const productId = String(comp.product);
        const product = productById.get(productId) ?? productById.get(productId);
        const variant = product?.variants?.find((v) => v.size === comp.size);
        const available =
          comboStock.get(productId)?.sellableMl ??
          stockByProduct.get(productId)?.sellableMl ??
          0;
        if (
          !product ||
          !variant ||
          variant.isActive === false ||
          available < comp.millilitres * cl.quantity
        ) {
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
          stockAllocations: [],
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
 *  Payment snapshot — the authoritative, frozen payment terms.
 * ------------------------------------------------------------------ */

/**
 * The advance rules, derived from the order's FROZEN snapshot.
 *
 * `advanceRequired` + `advanceAmount` come from `paymentSnapshot`, which
 * was written at creation time from the admin's PaymentMethod config.
 * An order created BEFORE this feature existed has no snapshot, so it
 * falls back to "no advance, pay everything on delivery" — the exact
 * behaviour it had before.
 */
export interface PaymentTerms {
  advanceRequired: boolean;
  advanceAmount: number;
  remainingOnDelivery: number;
  /** The amount that must be settled for the order to count as fully paid. */
  settlementTarget: number;
}

export function getPaymentTerms(order: {
  total: number;
  paymentSnapshot?: IPaymentSnapshot | null;
}): PaymentTerms {
  const snapshot = order.paymentSnapshot;
  const advanceRequired = snapshot?.advanceRequired === true;
  const advanceAmount = advanceRequired
    ? Math.max(0, Math.min(snapshot?.advanceAmount ?? 0, order.total))
    : 0;
  const remainingOnDelivery = Math.max(0, order.total - advanceAmount);
  return {
    advanceRequired,
    advanceAmount,
    remainingOnDelivery,
    /**
     * The order is only FULLY paid once the WHOLE amount is settled —
     * not merely once the advance is verified. With an advance, paying
     * the advance moves the order to `pending_verification`, never to
     * `paid`.
     */
    settlementTarget: order.total,
  };
}

/**
 * Build the immutable payment snapshot for a new order.
 *
 * The backend is AUTHORITATIVE: the percentage comes from the stored
 * `PaymentMethod` record, never from the request body. The storefront
 * sends only a `paymentMethod` id — `createOrderSchema` is `.strict()`,
 * so a client-supplied `advanceAmount` / `advancePaymentPercent` is
 * rejected as an unknown key before it ever reaches this function.
 */
async function buildPaymentSnapshot(
  paymentMethodId: string | undefined,
  total: number
): Promise<IPaymentSnapshot | undefined> {
  if (!paymentMethodId) return undefined;

  const method = await PaymentMethod.findById(paymentMethodId)
    .select(
      'name type accountNumber accountName instructions advancePaymentRequired advancePaymentPercent isActive'
    )
    .lean()
    .exec();
  if (!method) return undefined;

  /**
   * A DISABLED advance must never influence any calculation, so the
   * percentage is forced to 0 and the amount to 0 regardless of what the
   * record happens to contain.
   */
  const advanceRequired =
    method.advancePaymentRequired === true && method.isActive !== false;
  const advancePercent = advanceRequired
    ? Math.max(0, Math.min(Number(method.advancePaymentPercent) || 0, 100))
    : 0;

  /**
   * BDT rounding: the shop prices in whole taka, so the advance is
   * rounded to the nearest whole taka. `Math.round` (not `floor`) means
   * a 30% advance on ৳1,667 is ৳500 rather than ৳499.
   */
  const advanceAmount = advanceRequired
    ? Math.min(total, Math.round((total * advancePercent) / 100))
    : 0;
  const remainingOnDelivery = Math.max(0, total - advanceAmount);

  return {
    methodName: method.name ?? '',
    methodType: method.type ?? '',
    advanceRequired,
    advancePercent,
    advanceAmount,
    remainingOnDelivery,
    totalAmount: total,
    accountNumber: method.accountNumber ?? '',
    accountName: method.accountName ?? '',
    instructions: (method.instructions as string[]) ?? [],
  };
}

/* ------------------------------------------------------------------
 *  Create — orchestrator: validate → price → deduct inventory → mint
 *  order number → reserve coupon → save.
 * ------------------------------------------------------------------ */

export async function createOrder(
  input: {
    /** The customer account the order belongs to. Absent for guest orders. */
    customer?: string;
    /** Guest buyer details. Present only on anonymous checkout orders. */
    guestInfo?: IGuestInfo;
    orderSource: 'online' | 'manual';
    items: { product: string; size: ProductSize; quantity: number }[];
    combos?: { combo: string; quantity: number }[];
    shippingAddress: { label?: string; district: string; area: string; address: string };
    paymentMethod?: string;
    couponCode?: string;
    notes?: string;
    /** Payment evidence (sender mobile + TrxID) supplied at checkout. */
    paymentDetails?: { senderMobile: string; transactionId: string };
    /** Client idempotency key — a retry with the same key returns the original order. */
    idempotencyKey?: string | null;
  },
  actorId: string
): Promise<PublicOrder> {
  /* (0) Idempotency — a retried request must not create a second order or
   *     deduct stock twice. The unique sparse index on `idempotencyKey`
   *     makes this safe under concurrency. */
  if (input.idempotencyKey) {
    const existing = await Order.findOne({
      idempotencyKey: input.idempotencyKey,
    })
      .populate('customer', 'name phone email role')
      .populate('paymentMethod')
      .lean()
      .exec();
    if (existing) {
      return toPublicOrder(existing as unknown as OrderDoc);
    }
  }

  /* (0b) Resolve WHO this order belongs to.
   *
   * Three cases, and exactly one must apply:
   *   - guest checkout  → `guestInfo` present, `customer` absent
   *   - customer online → `customer` present, matching the signed-in actor
   *   - admin manual    → `customer` present, actor is an admin
   *
   * The route guard already refuses a mismatched `customer`, but the
   * service re-checks so that no other caller can bypass it. */
  const isGuestOrder = !!input.guestInfo && !input.customer;

  if (!isGuestOrder && !input.customer) {
    throw ApiError.badRequest(
      'Either a customer account or guest details are required to place an order'
    );
  }
  if (isGuestOrder && input.customer) {
    throw ApiError.badRequest(
      'Provide either a customer account or guest details, not both'
    );
  }

  /* The guest needs a real `User` row so they show up in Admin Orders and
   * the Admin Customers module. The order ALSO stores an immutable
   * `guestInfo` snapshot — that snapshot is the authoritative record of
   * what the shopper typed. */
  let customerId: string | null = input.customer ?? null;
  if (isGuestOrder && input.guestInfo) {
    const guest = await findOrCreateGuestUser(input.guestInfo);
    customerId = guest.id;
  }

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

  /* (2) Inventory deduction — FIFO across the product's batches. We
   *     compute the future order id BEFORE deducting so the log row's
   *     referenceId is accurate. Mongo's _id is generated on the client;
   *     use the pre-generated id (mongoose uses ObjectId by default). */
  const futureOrderId = new (await import('mongoose')).Types.ObjectId().toString();

  /** Everything we consume, so a mid-flight failure can be compensated. */
  const consumed: { batch: string; millilitres: number }[] = [];

  try {
    const builtItems: PublicOrder['items'] = [];
    for (const resolved of calc.items) {
      const allocations = await consumeFifo(
        resolved.product.id,
        resolved.millilitres,
        {
          referenceId: futureOrderId,
          note: `Order line — ${resolved.product.name} (${resolved.size})`,
          actorId,
        }
      );
      consumed.push(...allocations);
      builtItems.push({
        product: resolved.product,
        size: resolved.size,
        quantity: resolved.quantity,
        millilitres: resolved.millilitres,
        unitPrice: resolved.unitPrice,
        totalPrice: resolved.totalPrice,
        stockAllocations: allocations,
      });
    }

    /* (3) Combo expansion — each component consumes from its product's pool */
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
        const components: PublicOrderCombo['components'] = [];
        for (const comp of combo.products) {
          const componentProductId = String(comp.product);
          const ml = (comp.millilitres as number) * cl.quantity;
          const allocations = await consumeFifo(componentProductId, ml, {
            referenceId: futureOrderId,
            note: `Combo line — ${combo.name} (${comp.size})`,
            actorId,
          });
          consumed.push(...allocations);
          components.push({
            product: componentProductId,
            size: comp.size,
            ml: comp.millilitres as number,
            stockAllocations: allocations,
          });
        }
        builtCombos.push({
          combo: { id: cl.combo, name: combo.name, slug: combo.slug },
          quantity: cl.quantity,
          unitPrice: combo.comboPrice,
          totalPrice: combo.comboPrice * cl.quantity,
          components,
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
    /**
     * The immutable payment snapshot.
     *
     * Computed HERE, from the stored PaymentMethod record, so the
     * backend — not the browser — decides the advance amount. The
     * snapshot is frozen onto the order, which means a later edit to the
     * admin's payment-method config cannot change what this customer
     * owes, what the confirmation email said, or what the admin's
     * verification screen compares against.
     */
    const paymentSnapshot = await buildPaymentSnapshot(
      input.paymentMethod,
      calc.total
    );

    const created = await Order.create({
      _id: futureOrderId,
      customer: customerId,
      /**
       * Immutable snapshot of the guest buyer's details. Written only for
       * guest orders — for registered customers the `User` account IS the
       * source of truth and no snapshot is needed.
       */
      ...(isGuestOrder && input.guestInfo
        ? { guestInfo: input.guestInfo }
        : {}),
      orderSource: input.orderSource,
      items: builtItems.map((item) => ({
        product: item.product.id,
        size: item.size,
        quantity: item.quantity,
        millilitres: item.millilitres,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        productSnapshot: {
          name: item.product.name,
          slug: item.product.slug,
          image: item.product.image ?? { url: '', fileId: '' },
        },
        stockAllocations: item.stockAllocations,
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
      /**
       * Frozen payment terms. Only written when the order actually has a
       * payment method — an order with no method has no advance, so the
       * snapshot would be noise.
       */
      ...(paymentSnapshot ? { paymentSnapshot } : {}),
      paymentStatus: 'unpaid',
      orderStatus: 'pending',
      shippingAddress: input.shippingAddress,
      notes: input.notes ?? '',
      /**
       * Payment evidence the customer supplied at checkout (bKash/Nagad
       * sender number + TrxID). Stored so the admin can verify the payment
       * against the customer's screenshot without asking them again.
       */
      ...(input.paymentDetails
        ? { paymentDetails: input.paymentDetails }
        : {}),
      /**
       * Only set when the client supplied a key. Writing `null` explicitly
       * would defeat the sparse unique index — MongoDB only skips ABSENT
       * fields, so two keyless orders would collide on `idempotencyKey: null`.
       */
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      /**
       * A guest order gets a cryptographically secure public token so its
       * status can be looked up anonymously WITHOUT exposing the
       * sequential, guessable `orderNumber` as the capability.
       *
       * Registered orders do not need one — they are fetched through the
       * authenticated `/users/me/orders` route.
       */
      ...(isGuestOrder ? { publicToken: generatePublicToken() } : {}),
      inventoryReversed: false,
      /**
       * The authenticated actor. A guest order has NO actor — we leave the
       * field absent rather than substituting an admin id, because
       * `createdBy` answers "who placed this order" and the truthful answer
       * for a guest is "nobody we can identify as a staff member".
       */
      ...(actorId ? { createdBy: actorId } : {}),
    });

    return toPublicOrder(created as unknown as OrderDoc);
  } catch (err) {
    /* (6) Compensating action. There are no Mongo transactions available
   *     (standalone deployment), so a failure after the stock was
   *     consumed must restore it explicitly — into the SAME batches. */
    if (consumed.length > 0) {
      await rollbackConsumption(consumed, {
        referenceId: futureOrderId,
        note: 'Order creation failed — stock restored',
        actorId,
      });
    }
    throw err;
  }
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

  /* Reverse inventory on transitions to cancelled / returned — exactly once.
   *
   * The `inventoryReversed` flag is CLAIMED ATOMICALLY FIRST. Two
   * concurrent cancel requests would otherwise both read
   * `inventoryReversed: false` and both restore the same ml — a double
   * credit. The claim is a single `findOneAndUpdate` whose filter
   * requires the flag to still be false, so exactly one caller wins.
   *
   * Restoration is EXACT: each order line and combo component persisted
   * the `stockAllocations` (which batches it drew from, and how much)
   * at the time of the sale. We credit those same batches back — never
   * a "find the batch for this product" guess, which would be ambiguous
   * once a product has several purchase batches.
   *
   * `restoreAllocations` touches `remainingMl` ONLY. `totalMl` is the
   * physical capacity of the bottles and never changes when a sale is
   * undone (the liquid always existed). */
  if (next === 'cancelled' || next === 'returned') {
    const claimed = await Order.findOneAndUpdate(
      { _id: id, inventoryReversed: false },
      { $set: { inventoryReversed: true } },
      { new: true }
    ).lean();

    // Someone else already claimed the reversal — do not restore twice.
    if (!claimed) {
      const updated = (await Order.findOneAndUpdate(
        { _id: id },
        { $set: { orderStatus: next } },
        { new: true, runValidators: true }
      )
        .lean()
        .exec()) as OrderDoc | null;
      if (!updated) throw ApiError.notFound('Order not found');
      return toPublicOrder(updated);
    }

    const allocations: StockAllocation[] = [];
    for (const item of claimed.items ?? []) {
      for (const alloc of item.stockAllocations ?? []) {
        allocations.push({
          batch: String((alloc.batch as unknown as { toString(): string }).toString()),
          millilitres: alloc.millilitres,
        });
      }
    }
    for (const combo of claimed.combos ?? []) {
      for (const comp of combo.components ?? []) {
        for (const alloc of comp.stockAllocations ?? []) {
          allocations.push({
            batch: String((alloc.batch as unknown as { toString(): string }).toString()),
            millilitres: alloc.millilitres,
          });
        }
      }
    }

    if (allocations.length > 0) {
      await restoreAllocations(allocations, {
        referenceId: String(claimed._id),
        note: `Reversed order ${claimed.orderNumber} (${next})${reason ? ` — ${reason}` : ''}`,
        actorId,
      });
    }
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

  /**
   * When an admin manually flips to 'paid', the order is settled in
   * full, so `paidAmount` is set to the order total (the invoice then
   * shows fully paid). For any other transition we leave `paidAmount`
   * alone — partial payments survive the status flip.
   *
   * NOTE: with an advance payment configured, 'paid' still means the
   * WHOLE order is settled. Flipping to 'paid' after only the advance
   * was verified would be wrong, so the admin UI must not offer 'paid'
   * until the remaining-on-delivery amount is also collected.
   */
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

  /**
   * Auto-flip payment status.
   *
   * The comparison uses the order's FROZEN payment terms, not a fixed
   * percentage and not the live PaymentMethod config:
   *
   *   - `paidAmount >= total` → the whole order is settled → 'paid'.
   *   - `paidAmount > 0` but less than the total → the money received
   *     still needs the admin to verify it → 'pending_verification'.
   *
   * With an advance configured, recording the ADVANCE amount alone lands
   * the order in 'pending_verification' — never 'paid'. The remaining
   * on-delivery amount is collected later, and only when the cumulative
   * `paidAmount` reaches the order total does the order become 'paid'.
   */
  const terms = getPaymentTerms(order);
  let nextStatus: PaymentStatus = order.paymentStatus;
  if (paidAmount >= terms.settlementTarget) {
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
