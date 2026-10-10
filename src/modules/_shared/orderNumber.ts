import { getSettings } from '../settings/settings.service';
import { nextSeq } from './counter';

/**
 * Mint a human-readable order number using the prefix from Settings, the
 * current year, and a 6-digit zero-padded counter.
 *
 * Example: `FS-2026-000001`
 *
 * Year-stamping means the counter auto-resets every January 1st — no manual
 * rollover required. The Order model pre-save hook calls this when
 * `orderNumber` is missing, so any code path that creates an Order gets a
 * valid number without remembering to call it explicitly.
 */
export async function generateOrderNumber(): Promise<string> {
  const settings = await getSettings();
  const prefix = settings.orderNumberPrefix || 'FS';
  const year = new Date().getFullYear();
  const seq = await nextSeq(`order:${year}`);
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Same shape as `generateOrderNumber` but for invoices — separate counter,
 * separate prefix.
 *
 * Example: `INV-2026-000001`
 */
export async function generateInvoiceNumber(): Promise<string> {
  const settings = await getSettings();
  const prefix = settings.invoicePrefix || 'INV';
  const year = new Date().getFullYear();
  const seq = await nextSeq(`invoice:${year}`);
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}
