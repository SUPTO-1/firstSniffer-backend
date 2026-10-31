/**
 * Email transport contracts.
 *
 * The email module is deliberately dumb about WHAT it sends — it only knows
 * how to hand a rendered message to Resend and report the outcome. Policy
 * questions ("should this order get an email?", "does a failure block the
 * order?") belong to the caller.
 */

/** A rendered email ready for the provider. */
export interface EmailMessage {
  /** Recipient. Must be a single, valid address. */
  to: string;
  subject: string;
  /** The HTML body. Templates live in `email.templates.ts`. */
  html: string;
  /** Optional plain-text fallback for clients that cannot render HTML. */
  text?: string;
}

/**
 * The outcome of a send attempt.
 *
 * `sent: false` is a NORMAL outcome, not an exception. The transport never
 * throws for a provider-side failure, because the two callers that matter
 * (OTP registration and order confirmation) both need to decide for
 * themselves whether a failed email should abort their business flow — and
 * for the order flow the answer is always "no".
 */
export interface SendEmailResult {
  sent: boolean;
  /** Resend's message id when the send succeeded. */
  id?: string;
  /** A safe, human-readable failure reason. Never contains credentials. */
  error?: string;
  /** The HTTP status Resend returned, when there was one. */
  statusCode?: number;
}
