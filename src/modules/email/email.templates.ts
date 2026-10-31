/**
 * HTML email templates.
 *
 * These are PURE functions — no I/O, no env access, no database. They take
 * plain data and return a string. That keeps them trivially unit-testable
 * and means a template bug can never take down an order flow.
 *
 * DESIGN NOTES
 * ------------
 * Email clients are hostile to modern CSS: no flexbox in Outlook, no CSS
 * variables, no `gap`, no media queries that reliably work. So the layout
 * is built from TABLE elements with inline styles — the only thing every
 * client (including Outlook 2016) renders predictably.
 *
 * The palette matches First Sniffer's storefront: near-black `#111111`,
 * warm off-white `#F5F5F5`, and the muted tan used in the product imagery.
 */

/* ------------------------------------------------------------------
 *  Shared primitives
 * ------------------------------------------------------------------ */

const BRAND = {
  ink: '#111111',
  muted: '#6B6B6B',
  line: '#EAEAEA',
  surface: '#F5F5F5',
  accent: '#A87544',
  success: '#0F7B4F',
  danger: '#B42318',
};

const STORE_NAME = 'First Sniffer';
const STORE_TAGLINE = 'Authentic luxury decants — hand-filled in Dhaka.';

/**
 * Escape a value for interpolation into HTML.
 *
 * Order data contains customer-supplied strings (names, addresses, coupon
 * codes, payment transaction ids). Without escaping, a customer could put
 * `<script>` in their name and have it land in an inbox. Every dynamic
 * value in every template goes through this.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a number as Bangladeshi Taka. Whole taka, no decimals. */
export function formatBDT(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '৳0';
  return `৳${Math.round(n).toLocaleString('en-BD')}`;
}

/** Format a date as `12 Oct 2026`. */
export function formatDate(value: Date | string | undefined | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** The outer shell every template shares. */
function layout(options: {
  title: string;
  preheader: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(options.title)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse !important; }
  img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a { color: ${BRAND.ink}; }
  @media only screen and (max-width: 620px) {
    .fs-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .fs-stack { display: block !important; width: 100% !important; max-width: 100% !important; }
    .fs-h1 { font-size: 24px !important; line-height: 30px !important; }
    .fs-code { font-size: 30px !important; letter-spacing: 8px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#F5F5F5; -webkit-font-smoothing:antialiased;">
  <div style="display:none; font-size:1px; color:#F5F5F5; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
    ${escapeHtml(options.preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F5F5;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#FFFFFF; border:1px solid ${BRAND.line}; border-radius:16px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td class="fs-pad" style="padding:28px 32px 20px; border-bottom:1px solid ${BRAND.line};">
              <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:11px; letter-spacing:4px; text-transform:uppercase; color:${BRAND.muted};">${STORE_NAME}</p>
              <p style="margin:8px 0 0; font-family:Georgia,'Times New Roman',serif; font-size:13px; color:${BRAND.muted};">${escapeHtml(STORE_TAGLINE)}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="fs-pad" style="padding:32px;">
${options.body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="fs-pad" style="padding:24px 32px 28px; background-color:${BRAND.surface}; border-top:1px solid ${BRAND.line};">
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:18px; color:${BRAND.muted};">
                You are receiving this message because you have an account or placed an order with ${STORE_NAME}.
              </p>
              <p style="margin:10px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:18px; color:${BRAND.muted};">
                Need help? Reply to this email or contact us through the store.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** A heading + paragraph block. */
function heading(title: string): string {
  return `<h1 class="fs-h1" style="margin:0 0 12px; font-family:Georgia,'Times New Roman',serif; font-size:26px; line-height:34px; font-weight:normal; color:${BRAND.ink};">${escapeHtml(title)}</h1>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; color:#333333;">${escapeHtml(text)}</p>`;
}

/** A small uppercase label, used above values. */
function label(text: string): string {
  return `<p style="margin:0 0 4px; font-family:Arial,Helvetica,sans-serif; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:${BRAND.muted};">${escapeHtml(text)}</p>`;
}

/** A key/value row used in the summary tables. */
function row(cells: { label: string; value: string; strong?: boolean }[]): string {
  return `<tr>
${cells
  .map(
    (cell) => `      <td style="padding:10px 0; border-bottom:1px solid ${BRAND.line}; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${cell.strong ? BRAND.ink : '#333333'}; font-weight:${cell.strong ? 'bold' : 'normal'};">${escapeHtml(cell.label)}</td>
      <td align="right" style="padding:10px 0; border-bottom:1px solid ${BRAND.line}; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${BRAND.ink}; font-weight:${cell.strong ? 'bold' : 'normal'}; white-space:nowrap;">${escapeHtml(cell.value)}</td>`
  )
  .join('\n')}
  </tr>`;
}

/** A prominent call-to-action button. */
function button(href: string, text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
            <tr>
              <td align="center" bgcolor="${BRAND.ink}" style="border-radius:999px;">
                <a href="${escapeHtml(href)}" style="display:inline-block; padding:14px 34px; font-family:Arial,Helvetica,sans-serif; font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:bold; color:#FFFFFF; text-decoration:none; border-radius:999px;">${escapeHtml(text)}</a>
              </td>
            </tr>
          </table>`;
}

/** A bordered information panel. */
function panel(inner: string, background = BRAND.surface): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${background}; border:1px solid ${BRAND.line}; border-radius:12px; margin:0 0 24px;">
            <tr><td style="padding:20px;">${inner}</td></tr>
          </table>`;
}

/* ------------------------------------------------------------------
 *  OTP verification email
 * ------------------------------------------------------------------ */

export interface OtpEmailPayload {
  /** The customer's display name. */
  name: string;
  /** The PLAIN 6-digit code. Used only to build the email body. */
  otp: string;
  /** Minutes the code stays valid. */
  expiresInMinutes: number;
}

/**
 * The registration verification email.
 *
 * The code is rendered as six separate characters so it is easy to read
 * aloud or type on a phone, which matters far more here than in most
 * flows — this is Bangladesh, where a large share of customers are on
 * mobile data.
 */
export function buildOtpEmail(payload: OtpEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const { name, otp, expiresInMinutes } = payload;

  const codeCells = otp
    .split('')
    .map(
      (digit) =>
        `<td align="center" style="width:38px; height:48px; background-color:#FFFFFF; border:1px solid ${BRAND.line}; border-radius:8px; font-family:'Courier New',Courier,monospace; font-size:24px; font-weight:bold; color:${BRAND.ink};">${escapeHtml(digit)}</td>`
    )
    .join('</tr><tr><td style="height:8px; font-size:0; line-height:0;">&nbsp;</td>');

  const body = `${heading(`Verify your email`)}
${paragraph(`Hi ${name}, welcome to ${STORE_NAME}. Enter this code to finish creating your account.`)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <tr>${codeCells}</tr>
</table>
${panel(
  `${label('This code expires in')}
   <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; color:${BRAND.ink};">${escapeHtml(
     String(expiresInMinutes)
   )} minutes. You can request a new code if it expires.</p>`
)}
${paragraph(
  'If you did not create a First Sniffer account, you can safely ignore this email — no account will be created.'
)}`;

  return {
    subject: `${STORE_NAME} — your verification code`,
    html: layout({
      title: 'Your verification code',
      preheader: `Your ${STORE_NAME} verification code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
      body,
    }),
    text: [
      `Hi ${name},`,
      '',
      `Your ${STORE_NAME} verification code is: ${otp}`,
      '',
      `This code expires in ${expiresInMinutes} minutes.`,
      '',
      'If you did not create an account, you can safely ignore this email.',
    ].join('\n'),
  };
}

/* ------------------------------------------------------------------
 *  Order confirmation email
 * ------------------------------------------------------------------ */

export interface OrderEmailLine {
  name: string;
  size: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface OrderEmailPayload {
  customerName: string;
  orderNumber: string;
  orderDate: Date | string;
  items: OrderEmailLine[];
  subtotal: number;
  discount: number;
  couponCode?: string | null;
  shippingCharge: number;
  total: number;
  /** Whether the selected method requires an advance payment. */
  advanceRequired: boolean;
  advancePercent: number;
  advanceAmount: number;
  remainingOnDelivery: number;
  paymentMethodName?: string | null;
  /** Admin-authored instructions for the selected payment method. */
  paymentInstructions?: string[];
  /** The payment method's account number (bKash/Nagad wallet). */
  paymentAccountNumber?: string | null;
  paymentAccountName?: string | null;
  /** Customer-submitted payment evidence. */
  senderMobile?: string | null;
  transactionId?: string | null;
  deliveryAddress: {
    name?: string | null;
    phone?: string | null;
    area?: string | null;
    district?: string | null;
    address?: string | null;
  };
  /** Secure tracking URL. */
  trackingUrl?: string | null;
}

/**
 * The order confirmation email.
 *
 * Everything shown here is derived from the ORDER's immutable snapshot, not
 * from the live PaymentMethod configuration — so an order created under a
 * 30% advance rule keeps saying 30% even after the admin changes the
 * method to 20%.
 */
export function buildOrderConfirmationEmail(payload: OrderEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const p = payload;

  /* ----- Line items ----- */
  const itemRows = p.items
    .map(
      (item) => `<tr>
      <td style="padding:12px 0; border-bottom:1px solid ${BRAND.line};">
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:${BRAND.ink};">${escapeHtml(item.name)}</p>
        <p style="margin:2px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:${BRAND.muted};">${escapeHtml(item.size)} · ${escapeHtml(item.quantity)} × ${escapeHtml(formatBDT(item.unitPrice))}</p>
      </td>
      <td align="right" valign="top" style="padding:12px 0; border-bottom:1px solid ${BRAND.line}; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${BRAND.ink}; white-space:nowrap;">${escapeHtml(formatBDT(item.totalPrice))}</td>
    </tr>`
    )
    .join('\n');

  /* ----- Totals ----- */
  const totalRows = [
    row([{ label: 'Subtotal', value: formatBDT(p.subtotal) }]),
    ...(p.discount > 0
      ? [
          row([
            {
              label: p.couponCode ? `Discount (${p.couponCode})` : 'Discount',
              value: `-${formatBDT(p.discount)}`,
            },
          ]),
        ]
      : []),
    row([{ label: 'Shipping', value: formatBDT(p.shippingCharge) }]),
    row([{ label: 'Total payable', value: formatBDT(p.total), strong: true }]),
  ].join('\n');

  /* ----- Payment block ----- */
  const advanceBlock = p.advanceRequired
    ? panel(
        `${label(`Advance payment (${p.advancePercent}%)`)}
         <p style="margin:0 0 12px; font-family:Arial,Helvetica,sans-serif; font-size:20px; font-weight:bold; color:${BRAND.ink};">${escapeHtml(formatBDT(p.advanceAmount))}</p>
         <p style="margin:0 0 12px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:22px; color:#333333;">Send this amount through the payment method you selected, then submit the sender mobile number and transaction ID so we can verify it.</p>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
           <tr>
             <td style="padding:8px 0; border-top:1px solid ${BRAND.line}; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:${BRAND.muted};">Remaining on delivery</td>
             <td align="right" style="padding:8px 0; border-top:1px solid ${BRAND.line}; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:${BRAND.ink};">${escapeHtml(formatBDT(p.remainingOnDelivery))}</td>
           </tr>
         </table>`
      )
    : panel(
        `${label('Payment on delivery')}
         <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:18px; font-weight:bold; color:${BRAND.ink};">${escapeHtml(formatBDT(p.total))}</p>
         <p style="margin:8px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:21px; color:${BRAND.muted};">No advance payment is required. Please pay the full amount when your order arrives.</p>`
      );

  /* ----- The account the customer sends money to ----- */
  const accountBlock =
    p.paymentMethodName && (p.paymentAccountNumber || p.paymentInstructions?.length)
      ? panel(
          `${label('Send payment to')}
           <p style="margin:0 0 4px; font-family:Georgia,'Times New Roman',serif; font-size:18px; color:${BRAND.ink};">${escapeHtml(p.paymentMethodName)}</p>
           ${p.paymentAccountNumber ? `<p style="margin:0; font-family:'Courier New',Courier,monospace; font-size:16px; font-weight:bold; color:${BRAND.ink};">${escapeHtml(p.paymentAccountNumber)}</p>` : ''}
           ${p.paymentAccountName ? `<p style="margin:4px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:${BRAND.muted};">${escapeHtml(p.paymentAccountName)}</p>` : ''}
           ${
             p.paymentInstructions?.length
               ? `<ol style="margin:12px 0 0; padding-left:18px; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:21px; color:#333333;">
                   ${p.paymentInstructions
                     .map((line) => `<li>${escapeHtml(line)}</li>`)
                     .join('')}
                 </ol>`
               : ''
           }`
        )
      : '';

  /* ----- The customer's own submitted evidence ----- */
  const evidenceBlock =
    p.senderMobile || p.transactionId
      ? panel(
          `${label('Your payment details')}
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
             ${
               p.senderMobile
                 ? `<tr><td style="padding:6px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:${BRAND.muted};">Sender mobile</td><td align="right" style="padding:6px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:${BRAND.ink};">${escapeHtml(p.senderMobile)}</td></tr>`
                 : ''
             }
             ${
               p.transactionId
                 ? `<tr><td style="padding:6px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:${BRAND.muted};">Transaction ID</td><td align="right" style="padding:6px 0; font-family:'Courier New',Courier,monospace; font-size:13px; color:${BRAND.ink};">${escapeHtml(p.transactionId)}</td></tr>`
                 : ''
             }
           </table>`
        )
      : '';

  /* ----- Delivery address ----- */
  const addressLines = [
    p.deliveryAddress.name,
    p.deliveryAddress.address,
    [p.deliveryAddress.area, p.deliveryAddress.district].filter(Boolean).join(', '),
    p.deliveryAddress.phone,
  ].filter(Boolean) as string[];

  const addressBlock = panel(
    `${label('Delivery address')}
     ${addressLines
       .map(
         (line, index) =>
           `<p style="margin:${index === 0 ? '0' : '2px'} 0 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:22px; color:${index === 0 ? BRAND.ink : '#333333'};${index === 0 ? ' font-weight:bold;' : ''}">${escapeHtml(line)}</p>`
       )
       .join('')}`
  );

  const trackingCta = p.trackingUrl
    ? `${button(p.trackingUrl, 'Track your order')}
       <p style="margin:0 0 24px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; color:${BRAND.muted}; word-break:break-all;">If the button does not work, copy this link:<br><a href="${escapeHtml(p.trackingUrl)}" style="color:${BRAND.ink};">${escapeHtml(p.trackingUrl)}</a></p>`
    : '';

  const body = `${heading(`Thank you, ${p.customerName}`)}
${paragraph(
  `We have received your order. We will verify the payment and get your parcel moving — you can track it any time using the link below.`
)}
${panel(
  `${label('Order number')}
   <p style="margin:0; font-family:'Courier New',Courier,monospace; font-size:20px; font-weight:bold; color:${BRAND.ink};">${escapeHtml(p.orderNumber)}</p>
   <p style="margin:6px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:${BRAND.muted};">Placed on ${escapeHtml(formatDate(p.orderDate))}</p>`
)}
${trackingCta}
${label('Your items')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  ${itemRows || `<tr><td style="padding:12px 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:${BRAND.muted};">No items.</td></tr>`}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  ${totalRows}
</table>
${advanceBlock}
${accountBlock}
${evidenceBlock}
${addressBlock}
${paragraph(
  'If anything looks wrong, reply to this email and we will sort it out before dispatch.'
)}`;

  const text = [
    `Thank you, ${p.customerName}.`,
    '',
    `Your order ${p.orderNumber} has been received.`,
    `Placed on ${formatDate(p.orderDate)}.`,
    '',
    'YOUR ITEMS',
    ...p.items.map(
      (item) =>
        `- ${item.name} (${item.size}) x${item.quantity} — ${formatBDT(item.totalPrice)}`
    ),
    '',
    `Subtotal: ${formatBDT(p.subtotal)}`,
    ...(p.discount > 0
      ? [`Discount${p.couponCode ? ` (${p.couponCode})` : ''}: -${formatBDT(p.discount)}`]
      : []),
    `Shipping: ${formatBDT(p.shippingCharge)}`,
    `Total payable: ${formatBDT(p.total)}`,
    '',
    p.advanceRequired
      ? `ADVANCE PAYMENT (${p.advancePercent}%): ${formatBDT(p.advanceAmount)}\nRemaining on delivery: ${formatBDT(p.remainingOnDelivery)}`
      : `PAYMENT ON DELIVERY: ${formatBDT(p.total)}`,
    ...(p.paymentMethodName
      ? [
          '',
          `SEND PAYMENT TO — ${p.paymentMethodName}`,
          ...(p.paymentAccountNumber ? [`Account: ${p.paymentAccountNumber}`] : []),
          ...(p.paymentAccountName ? [`Name: ${p.paymentAccountName}`] : []),
          ...(p.paymentInstructions?.length
            ? ['', ...p.paymentInstructions.map((line, i) => `${i + 1}. ${line}`)]
            : []),
        ]
      : []),
    ...(p.senderMobile || p.transactionId
      ? [
          '',
          'YOUR PAYMENT DETAILS',
          ...(p.senderMobile ? [`Sender mobile: ${p.senderMobile}`] : []),
          ...(p.transactionId ? [`Transaction ID: ${p.transactionId}`] : []),
        ]
      : []),
    '',
    'DELIVERY ADDRESS',
    ...addressLines.map((line) => `- ${line}`),
    ...(p.trackingUrl ? ['', `TRACK YOUR ORDER: ${p.trackingUrl}`] : []),
  ].join('\n');

  return {
    subject: `Your ${STORE_NAME} order ${p.orderNumber} is confirmed`,
    html: layout({
      title: `Order ${p.orderNumber} confirmed`,
      preheader: `Order ${p.orderNumber} confirmed — total ${formatBDT(p.total)}.`,
      body,
    }),
    text,
  };
}

/* ------------------------------------------------------------------
 *  Password reset email
 * ------------------------------------------------------------------ */

export interface PasswordResetEmailPayload {
  /** The customer's display name. */
  name: string;
  /** The PLAIN reset code. Used only to build the email body. */
  code: string;
  /** The full link the customer clicks. */
  resetUrl: string;
  /** Minutes the code stays valid. */
  expiresInMinutes: number;
}

/**
 * The password-reset email.
 *
 * The code is emailed as a CODE rather than only as a link, because the
 * storefront's reset screen takes a code + new password — that keeps the
 * reset flow inside the same single-page app and avoids a second hosted
 * page that would have to carry its own styling and security review.
 *
 * The link is included as well so the customer can click straight
 * through; the code is in the URL so the screen can pre-fill it.
 */
export function buildPasswordResetEmail(payload: PasswordResetEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const { name, code, resetUrl, expiresInMinutes } = payload;

  const codeCells = code
    .split('')
    .map(
      (digit) =>
        `<td align="center" style="width:38px; height:48px; background-color:#FFFFFF; border:1px solid ${BRAND.line}; border-radius:8px; font-family:'Courier New',Courier,monospace; font-size:24px; font-weight:bold; color:${BRAND.ink};">${escapeHtml(digit)}</td>`
    )
    .join('</tr><tr><td style="height:8px; font-size:0; line-height:0;">&nbsp;</td>');

  const body = `${heading('Reset your password')}
${paragraph(`Hi ${name}, we received a request to reset the password on your ${STORE_NAME} account. Enter this code to choose a new one.`)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <tr>${codeCells}</tr>
</table>
${button(resetUrl, 'Reset your password')}
${panel(
  `${label('This code expires in')}
   <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; color:${BRAND.ink};">${escapeHtml(
     String(expiresInMinutes)
   )} minutes. You can request a new code if it expires.</p>`
)}
${paragraph(
  'If you did not request a password reset, you can safely ignore this email — your password will not change.'
)}`;

  return {
    subject: `${STORE_NAME} — reset your password`,
    html: layout({
      title: 'Reset your password',
      preheader: `Your ${STORE_NAME} password reset code is ${code}. It expires in ${expiresInMinutes} minutes.`,
      body,
    }),
    text: [
      `Hi ${name},`,
      '',
      `We received a request to reset your ${STORE_NAME} password.`,
      '',
      `Your reset code is: ${code}`,
      '',
      `Or reset it directly: ${resetUrl}`,
      '',
      `This code expires in ${expiresInMinutes} minutes.`,
      '',
      'If you did not request a password reset, you can safely ignore this email — your password will not change.',
    ].join('\n'),
  };
}
