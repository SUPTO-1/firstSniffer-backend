import { Resend } from 'resend';
import { env } from '../../config/env';
import type { EmailMessage, SendEmailResult } from './email.interface';

/**
 * The single email transport for the whole application.
 *
 * DESIGN CONTRACT
 * ---------------
 * `sendEmail` NEVER THROWS. A provider outage is a normal, expected
 * condition for a third-party API — the two callers that matter (OTP
 * registration and order confirmation) each need to make their own policy
 * decision about it:
 *
 *   - Order confirmation: a failed email must NOT fail the order. The
 *     customer still gets their goods and their money is still verified.
 *   - OTP registration: a failed email should tell the customer to retry,
 *     because without the code they cannot complete signup — but it must
 *     still not crash the request with an opaque 500.
 *
 * Making the transport throw would push that decision onto every caller
 * and make the "never break the business flow" guarantee impossible to
 * audit. So the transport reports, and the caller decides.
 *
 * SECURITY
 * --------
 * The API key is read from the environment and never logged, never
 * returned, and never included in an error message. Only the provider's
 * own status code and message are surfaced, and even those are truncated.
 */

/**
 * The Resend client is created lazily so that importing this module never
 * throws — not even when `RESEND_API_KEY` is missing. A missing key
 * degrades to "every send fails with a clear reason", which is far easier
 * to diagnose than a boot-time crash.
 */
let client: Resend | null = null;
let clientKey: string | null = null;

/**
 * Test seam.
 *
 * When set, `sendEmail` returns this value instead of contacting Resend.
 * The automated suite sets it so that a test run never makes a real
 * network call and never consumes the configured account's sending quota.
 *
 * This is deliberately an in-process switch rather than an env var — the
 * value has to be settable at RUNTIME, after `env` has already been
 * frozen at import time, so a test can flip it per case.
 */
let overrideResult: SendEmailResult | null = null;

/**
 * The messages captured while the transport is stubbed.
 *
 * A stub that only returns a fixed result cannot answer "what did you
 * actually send?" — and several flows depend on that: the registration
 * OTP and the password reset both need a test to read the code out of
 * the email the way a customer would read it out of their inbox.
 *
 * So the stub RECORDS every message it is handed. The recording is
 * in-process and disappears with the process; nothing is written to disk.
 */
const sentMessages: EmailMessage[] = [];

/**
 * Replace the transport's outcome for the duration of a test.
 *
 * @param result What `sendEmail` should report instead of calling Resend.
 *               Pass `null` to restore the real transport.
 */
export function setEmailTransportOverride(
  result: SendEmailResult | null
): void {
  overrideResult = result;
  /**
   * Each stub starts a fresh capture, so a test never sees a message
   * that was sent under a previous stub.
   */
  sentMessages.length = 0;
}

/**
 * The messages sent while the transport was stubbed.
 *
 * Returns a COPY, so a test cannot mutate the recorded history.
 */
export function getSentMessages(): EmailMessage[] {
  return [...sentMessages];
}

/**
 * The most recently stubbed message, or `null` if nothing was sent.
 */
export function getLastSentMessage(): EmailMessage | null {
  return sentMessages.length > 0 ? sentMessages[sentMessages.length - 1] : null;
}

/**
 * Whether the transport is currently stubbed.
 *
 * Used by the test suite to assert that no network call happened.
 */
export function isEmailTransportOverridden(): boolean {
  return overrideResult !== null;
}

function getClient(): Resend | null {
  if (!env.email.apiKey) return null;
  // Re-create only when the key changes (it never does at runtime, but
  // this keeps the module honest under tests that mutate env).
  if (!client || clientKey !== env.email.apiKey) {
    client = new Resend(env.email.apiKey);
    clientKey = env.email.apiKey;
  }
  return client;
}

/**
 * Reduce an arbitrary thrown value to a short, safe string.
 *
 * We deliberately do NOT include the full error object: a Resend SDK error
 * can embed the request headers (which carry the API key) in its
 * `message`. Truncating and sanitising keeps that out of the logs.
 */
function safeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown error';
  // Strip anything that looks like a key, then cap the length.
  return raw
    .replace(/re_[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 300);
}

/**
 * Send one email.
 *
 * @returns `{ sent: true, id }` on success, or `{ sent: false, error }` on
 *          any failure — including a missing API key or sender address.
 */
export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const to = String(message.to ?? '').trim();
  if (!to) {
    return { sent: false, error: 'No recipient address' };
  }

  /* The test seam — no network call, no quota consumed. */
  if (overrideResult) {
    sentMessages.push(message);
    return overrideResult;
  }

  if (!env.email.apiKey) {
    // Not an error we want to spam the logs with on every send — but it
    // IS important that the caller knows the email did not go out.
    console.error('[email] RESEND_API_KEY is not configured — email not sent');
    return { sent: false, error: 'Email service is not configured' };
  }

  if (!env.email.from) {
    console.error('[email] EMAIL_FROM is not configured — email not sent');
    return { sent: false, error: 'Email sender is not configured' };
  }

  const resend = getClient();
  if (!resend) {
    return { sent: false, error: 'Email service is not configured' };
  }

  try {
    const result = await resend.emails.send({
      from: env.email.from,
      to,
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
    });

    // The SDK reports application-level failures in the body rather than
    // by throwing, so an HTTP 200 can still mean "rejected".
    if (result.error) {
      const statusCode =
        typeof result.error.statusCode === 'number'
          ? result.error.statusCode
          : undefined;
      const reason = safeErrorMessage(result.error.message);
      console.error(
        `[email] Resend rejected the message to ${to}:`,
        statusCode ?? 'no status',
        reason
      );
      return { sent: false, error: reason, statusCode };
    }

    return { sent: true, id: result.data?.id };
  } catch (err) {
    const reason = safeErrorMessage(err);
    console.error(`[email] Failed to send to ${to}:`, reason);
    return { sent: false, error: reason };
  }
}

/**
 * Whether email delivery is configured at all.
 *
 * Used by the OTP flow to tell the customer "email is temporarily
 * unavailable, please try again" rather than silently pretending an OTP
 * was sent when it was not.
 */
export function isEmailConfigured(): boolean {
  return Boolean(env.email.apiKey && env.email.from);
}
