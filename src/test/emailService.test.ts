import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOtpEmail,
  buildOrderConfirmationEmail,
  escapeHtml,
  formatBDT,
  formatDate,
} from '../modules/email/email.templates';
import {
  isEmailConfigured,
  isEmailTransportOverridden,
  sendEmail,
  setEmailTransportOverride,
} from '../modules/email/email.service';

/**
 * Email transport + template unit tests.
 *
 * These are PURE unit tests — no database, no network. The templates are
 * pure functions by design, and the transport is stubbed through its
 * in-process test seam.
 */

afterEach(() => {
  setEmailTransportOverride(null);
});

/* ==================================================================
 *  HTML escaping — the injection barrier
 * ================================================================== */

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('turns null and undefined into an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Chanel Dior Sauvage')).toBe('Chanel Dior Sauvage');
  });
});

/* ==================================================================
 *  Formatting
 * ================================================================== */

describe('formatBDT', () => {
  it('renders whole taka with thousands separators', () => {
    expect(formatBDT(1000)).toBe('৳1,000');
    expect(formatBDT(123456)).toBe('৳123,456');
  });

  it('rounds to the nearest whole taka', () => {
    expect(formatBDT(999.4)).toBe('৳999');
    expect(formatBDT(999.5)).toBe('৳1,000');
  });

  it('treats null, undefined and NaN as zero', () => {
    expect(formatBDT(null)).toBe('৳0');
    expect(formatBDT(undefined)).toBe('৳0');
    expect(formatBDT(Number.NaN)).toBe('৳0');
  });
});

describe('formatDate', () => {
  it('formats a date as `12 Oct 2026`', () => {
    expect(formatDate(new Date('2026-10-12T10:00:00Z'))).toMatch(/12 Oct 2026/);
  });

  it('falls back to an em dash for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

/* ==================================================================
 *  OTP template
 * ================================================================== */

describe('buildOtpEmail', () => {
  const payload = { name: 'Ayesha', otp: '042716', expiresInMinutes: 5 };

  it('produces a subject, HTML and a plain-text alternative', () => {
    const email = buildOtpEmail(payload);
    expect(email.subject).toMatch(/verification code/i);
    expect(email.html).toContain('<!DOCTYPE html>');
    expect(email.text).toContain('042716');
  });

  it('renders EVERY digit of the code', () => {
    const email = buildOtpEmail(payload);
    for (const digit of ['0', '4', '2', '7', '1', '6']) {
      expect(email.html).toContain(digit);
    }
  });

  it('states how long the code is valid', () => {
    const email = buildOtpEmail(payload);
    expect(email.html).toMatch(/5 minutes/);
    expect(email.text).toMatch(/5 minutes/);
  });

  it('tells a customer who did not sign up that they can ignore it', () => {
    const email = buildOtpEmail(payload);
    expect(email.text).toMatch(/safely ignore/i);
  });

  it('escapes the customer name', () => {
    const email = buildOtpEmail({ ...payload, name: '<img src=x onerror=alert(1)>' });
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img');
  });

  it('uses a table-based layout (Outlook-safe)', () => {
    const email = buildOtpEmail(payload);
    expect(email.html).toContain('<table');
    // No modern CSS that Outlook drops on the floor.
    expect(email.html).not.toMatch(/display:\s*flex/);
    expect(email.html).not.toMatch(/var\(--/);
  });
});

/* ==================================================================
 *  Order confirmation template
 * ================================================================== */

describe('buildOrderConfirmationEmail', () => {
  const base = {
    customerName: 'Ayesha Rahman',
    orderNumber: 'FS-2026-000123',
    orderDate: new Date('2026-10-12T10:00:00Z'),
    items: [
      {
        name: 'Dior Sauvage',
        size: '10ml',
        quantity: 2,
        unitPrice: 1200,
        totalPrice: 2400,
      },
    ],
    subtotal: 2400,
    discount: 200,
    couponCode: 'WELCOME10',
    shippingCharge: 100,
    total: 2300,
    advanceRequired: true,
    advancePercent: 30,
    advanceAmount: 690,
    remainingOnDelivery: 1610,
    paymentMethodName: 'bKash',
    paymentInstructions: ['Send to the personal number', 'Share the TrxID'],
    paymentAccountNumber: '01700000000',
    paymentAccountName: 'First Sniffer',
    senderMobile: '01800000000',
    transactionId: 'TXN12345',
    deliveryAddress: {
      name: 'Ayesha Rahman',
      phone: '01800000000',
      area: 'Dhanmondi',
      district: 'Dhaka',
      address: 'House 12, Road 5',
    },
    trackingUrl: 'https://shop.example.com/track/abc123',
  };

  it('includes the customer name and the order number', () => {
    const email = buildOrderConfirmationEmail(base);
    expect(email.html).toContain('Ayesha Rahman');
    expect(email.html).toContain('FS-2026-000123');
    expect(email.text).toContain('FS-2026-000123');
  });

  it('lists every ordered product with its size, quantity and price', () => {
    const email = buildOrderConfirmationEmail(base);
    expect(email.html).toContain('Dior Sauvage');
    expect(email.html).toContain('10ml');
    expect(email.html).toContain('2 × ৳1,200');
    expect(email.text).toContain('Dior Sauvage (10ml) x2');
  });

  it('shows the subtotal, discount, shipping and final total', () => {
    const email = buildOrderConfirmationEmail(base);
    expect(email.text).toContain('Subtotal: ৳2,400');
    expect(email.text).toContain('Discount (WELCOME10): -৳200');
    expect(email.text).toContain('Shipping: ৳100');
    expect(email.text).toContain('Total payable: ৳2,300');
  });

  it('omits the discount line when there is no discount', () => {
    const email = buildOrderConfirmationEmail({
      ...base,
      discount: 0,
      couponCode: null,
    });
    expect(email.text).not.toMatch(/Discount/);
  });

  it('shows the advance amount, percentage and remaining-on-delivery', () => {
    const email = buildOrderConfirmationEmail(base);
    expect(email.text).toContain('ADVANCE PAYMENT (30%): ৳690');
    expect(email.text).toContain('Remaining on delivery: ৳1,610');
    expect(email.html).toContain('Advance payment (30%)');
  });

  it('shows a plain full-COD breakdown when no advance is required', () => {
    const email = buildOrderConfirmationEmail({
      ...base,
      advanceRequired: false,
      advancePercent: 0,
      advanceAmount: 0,
      remainingOnDelivery: 2300,
    });
    expect(email.text).toContain('PAYMENT ON DELIVERY: ৳2,300');
    expect(email.text).not.toMatch(/ADVANCE PAYMENT/);
    expect(email.html).toMatch(/No advance payment is required/i);
  });

  it('includes the payment method, account number and admin instructions', () => {
    const email = buildOrderConfirmationEmail(base);
    expect(email.text).toContain('SEND PAYMENT TO — bKash');
    expect(email.text).toContain('Account: 01700000000');
    expect(email.text).toContain('Send to the personal number');
    expect(email.html).toContain('01700000000');
  });

  it('includes the customer-submitted transaction id and sender mobile', () => {
    const email = buildOrderConfirmationEmail(base);
    expect(email.text).toContain('Sender mobile: 01800000000');
    expect(email.text).toContain('Transaction ID: TXN12345');
  });

  it('omits the payment-evidence block when nothing was submitted', () => {
    const email = buildOrderConfirmationEmail({
      ...base,
      senderMobile: null,
      transactionId: null,
    });
    expect(email.text).not.toContain('YOUR PAYMENT DETAILS');
  });

  it('includes the delivery address', () => {
    const email = buildOrderConfirmationEmail(base);
    expect(email.text).toContain('House 12, Road 5');
    expect(email.text).toContain('Dhanmondi, Dhaka');
    expect(email.text).toContain('01800000000');
  });

  it('includes the secure tracking link', () => {
    const email = buildOrderConfirmationEmail(base);
    expect(email.text).toContain('https://shop.example.com/track/abc123');
    expect(email.html).toContain('https://shop.example.com/track/abc123');
  });

  it('omits the tracking block when there is no URL', () => {
    const email = buildOrderConfirmationEmail({ ...base, trackingUrl: null });
    expect(email.text).not.toContain('TRACK YOUR ORDER');
  });

  it('escapes customer-supplied values', () => {
    const email = buildOrderConfirmationEmail({
      ...base,
      customerName: '<script>alert(1)</script>',
      deliveryAddress: { ...base.deliveryAddress, address: '<b>x</b>' },
    });
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).not.toContain('<b>x</b>');
  });

  it('never leaks an internal Mongo id', () => {
    const email = buildOrderConfirmationEmail(base);
    // A 24-hex-char ObjectId must not appear anywhere in the email.
    expect(email.html).not.toMatch(/[0-9a-f]{24}/);
    expect(email.text).not.toMatch(/[0-9a-f]{24}/);
  });

  it('handles an order with no items without crashing', () => {
    const email = buildOrderConfirmationEmail({ ...base, items: [] });
    expect(email.html).toContain('No items.');
  });
});

/* ==================================================================
 *  Transport
 * ================================================================== */

describe('sendEmail', () => {
  it('never throws and reports success through the stub', async () => {
    setEmailTransportOverride({ sent: true, id: 'msg_123' });

    const result = await sendEmail({
      to: 'someone@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });

    expect(result.sent).toBe(true);
    expect(result.id).toBe('msg_123');
    expect(isEmailTransportOverridden()).toBe(true);
  });

  it('reports a failure without throwing', async () => {
    setEmailTransportOverride({ sent: false, error: 'provider exploded' });

    const result = await sendEmail({
      to: 'someone@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });

    expect(result.sent).toBe(false);
    expect(result.error).toBe('provider exploded');
  });

  it('rejects an empty recipient', async () => {
    const result = await sendEmail({ to: '   ', subject: 'Hi', html: '<p>Hi</p>' });
    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/recipient/i);
  });

  it('restores the real transport when the stub is cleared', async () => {
    setEmailTransportOverride({ sent: true, id: 'msg_123' });
    setEmailTransportOverride(null);
    expect(isEmailTransportOverridden()).toBe(false);
  });

  it('reports the configuration state without throwing', () => {
    expect(typeof isEmailConfigured()).toBe('boolean');
  });
});
