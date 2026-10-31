import { env } from '../../config/env';
import { Order } from '../order/order.model';
import type { OrderDoc } from '../order/order.interface';
import { getPaymentTerms } from '../order/order.service';
import { buildOrderConfirmationEmail, type OrderEmailPayload } from './email.templates';
import { sendEmail } from './email.service';

/**
 * The order confirmation email.
 *
 * DESIGN RULES (all enforced here, not by the caller)
 * ---------------------------------------------------
 * 1. NEVER FAILS THE ORDER. This module is called AFTER the order has
 *    been persisted and the stock deducted. It swallows every error, so
 *    a provider outage can never roll back a successful purchase.
 *
 * 2. NEVER SENDS TWICE. The send is claimed atomically on the order
 *    (`confirmationEmailSentAt`) BEFORE the email goes out, so a retried
 *    request or a concurrent trigger cannot double-send.
 *
 * 3. ONLY FOR ONLINE ORDERS. An admin-created (`manual`) order has no
 *    customer who placed it, so there is nobody to email.
 *
 * 4. ONLY WHEN THERE IS A RECIPIENT. Guest email is OPTIONAL — a guest
 *    who did not supply one simply gets no email, and the order still
 *    succeeds.
 *
 * 5. READS THE ORDER'S SNAPSHOT. The advance amount, the account number,
 *    the instructions — all come from `paymentSnapshot`, which was frozen
 *    at creation time. A later edit to the admin's PaymentMethod config
 *    must not change what this customer was told.
 */

export interface OrderConfirmationResult {
  /** Whether an email was actually sent. */
  sent: boolean;
  /** Why it was not sent — for logging and for the test suite. */
  reason?:
    | 'sent'
    | 'manual-order'
    | 'no-recipient'
    | 'already-sent'
    | 'provider-error';
  /** The provider's message id, when the send succeeded. */
  id?: string;
  /** The provider's error message, when the send failed. */
  error?: string;
}

/**
 * Build the tracking URL for an order.
 *
 * GUEST orders carry a high-entropy `publicToken`, so the emailed link is
 * `/track/<token>` — a capability that cannot be enumerated.
 *
 * REGISTERED orders keep their existing route (`/order-confirmed/<orderNumber>`)
 * because the customer can already see their orders while signed in, and
 * the sequential order number is not a secret to them.
 *
 * The base URL comes from `env.frontendUrl` — never a hardcoded
 * deployment hostname.
 */
function buildTrackingUrl(order: {
  publicToken?: string | null;
  orderNumber: string;
}): string | null {
  const base = (env.frontendUrl ?? '').replace(/\/+$/, '');
  if (!base) return null;
  if (order.publicToken) return `${base}/track/${order.publicToken}`;
  return `${base}/order-confirmed/${encodeURIComponent(order.orderNumber)}`;
}

/**
 * Work out who to send to, and what to call them.
 *
 * - A registered customer's address comes from their account.
 * - A guest's address comes from the order's own `guestInfo` snapshot.
 * - A guest who did not supply an email gets nothing — the order still
 *   goes through, we just have no way to reach them.
 */
function resolveRecipient(order: OrderDoc): {
  email: string | null;
  name: string;
} {
  const guest = order.guestInfo;
  const customer = order.customer as unknown as
    | { name?: string; email?: string | null }
    | undefined;

  if (guest) {
    const email = guest.email?.trim() || null;
    return { email, name: guest.name?.trim() || 'Customer' };
  }

  const email = customer?.email?.trim() || null;
  return { email, name: customer?.name?.trim() || 'Customer' };
}

/**
 * Assemble the email payload from the order document.
 *
 * Everything is read from the order's own immutable data — the items,
 * the totals, the address and the payment snapshot. Nothing is recomputed
 * from live config.
 */
export function buildOrderEmailPayload(
  order: OrderDoc
): { email: string; payload: OrderEmailPayload } | null {
  const { email, name } = resolveRecipient(order);
  if (!email) return null;
  const snapshot = order.paymentSnapshot;
  const terms = getPaymentTerms(order);

  /**
   * The line items. Only the product lines are emailed — a combo is
   * sold as a single product, and expanding it into its components
   * would confuse the customer rather than help them.
   */
  const items = (order.items ?? []).map((item) => ({
    name: item.productSnapshot?.name ?? 'Product',
    size: item.size,
    quantity: item.quantity ?? 1,
    unitPrice: item.unitPrice ?? 0,
    totalPrice: item.totalPrice ?? 0,
  }));

  const comboLines = (order.combos ?? []).map((combo) => ({
    name: combo.name ?? 'Combo',
    size: 'combo',
    quantity: combo.quantity ?? 1,
    unitPrice: combo.unitPrice ?? 0,
    totalPrice: combo.totalPrice ?? 0,
  }));

  const address = order.shippingAddress;

  return {
    email,
    payload: {
      customerName: name,
      orderNumber: order.orderNumber,
      orderDate: order.createdAt ?? new Date(),
      items: [...items, ...comboLines],
      subtotal: order.subtotal ?? 0,
      discount: order.discount ?? 0,
      couponCode: order.couponCode ?? null,
      shippingCharge: order.shippingCharge ?? 0,
      total: order.total ?? 0,
      advanceRequired: terms.advanceRequired,
      advancePercent: snapshot?.advancePercent ?? 0,
      advanceAmount: terms.advanceAmount,
      remainingOnDelivery: terms.remainingOnDelivery,
      paymentMethodName: snapshot?.methodName ?? null,
      paymentInstructions: snapshot?.instructions ?? [],
      paymentAccountNumber: snapshot?.accountNumber ?? null,
      paymentAccountName: snapshot?.accountName ?? null,
      senderMobile: order.paymentDetails?.senderMobile ?? null,
      transactionId: order.paymentDetails?.transactionId ?? null,
      deliveryAddress: {
        name,
        phone: order.guestInfo?.phone ?? null,
        area: address?.area ?? null,
        district: address?.district ?? null,
        address: address?.address ?? null,
      },
      trackingUrl: buildTrackingUrl(order),
    },
  };
}

/**
 * Send the order confirmation email.
 *
 * @param orderId The order to email about.
 */
export async function sendOrderConfirmationEmail(
  orderId: string
): Promise<OrderConfirmationResult> {
  try {
    /**
     * (1) Load the order — WITH THE CUSTOMER POPULATED.
     *
     * `customer` is stored as an ObjectId. Without `.populate()` the
     * field is just an id, and `resolveRecipient` would read
     * `customer.email` off a string — `undefined` — and conclude that
     * a registered customer has no address. The confirmation would
     * then be silently skipped for EVERY registered customer, which is
     * exactly the audience that expects one.
     *
     * The guest path does not need this: a guest's details live in the
     * order's own `guestInfo` snapshot.
     */
    const order = (await Order.findById(orderId)
      .populate('customer', 'name email phone')
      .lean()
      .exec()) as OrderDoc | null;
    if (!order) return { sent: false, reason: 'no-recipient' };

    /* (2) Admin-created orders have no customer to notify. */
    if (order.orderSource !== 'online') {
      return { sent: false, reason: 'manual-order' };
    }

    /* (3) No recipient → nothing to do. Guest email is optional. */
    const resolved = buildOrderEmailPayload(order);
    if (!resolved) return { sent: false, reason: 'no-recipient' };
    const { email, payload } = resolved;

    /* (4) CLAIM THE SEND.
     *
     * The filter requires `confirmationEmailSentAt` to still be null, so
     * exactly one caller can ever win the claim. Everyone else gets
     * `null` back and skips the send. The claim is taken BEFORE the
     * email goes out — if the provider then fails, the order keeps its
     * claim, and the customer is not spammed with retries for an order
     * they already have.
     */
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, confirmationEmailSentAt: null },
      { $set: { confirmationEmailSentAt: new Date() } },
      { new: true }
    )
      .lean()
      .exec();
    if (!claimed) return { sent: false, reason: 'already-sent' };

    /* (5) Send. The transport never throws, but a template bug could —
     * and it must still not break the order, which is already saved. */
    const message = buildOrderConfirmationEmail(payload);
    const result = await sendEmail({
      to: email,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (!result.sent) {
      console.error(
        `[email] Order confirmation for ${order.orderNumber} was not delivered:`,
        result.error ?? 'unknown error'
      );
      return { sent: false, reason: 'provider-error', error: result.error };
    }

    return { sent: true, reason: 'sent', id: result.id };
  } catch (err) {
    /**
     * A template or data bug must never surface as a failed order. The
     * order is already committed at this point; the customer keeps their
     * goods and the admin can still see the order.
     */
    console.error(
      '[email] Order confirmation failed unexpectedly:',
      err instanceof Error ? err.message : 'Unknown error'
    );
    return { sent: false, reason: 'provider-error' };
  }
}
