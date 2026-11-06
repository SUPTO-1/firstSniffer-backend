import { describe, expect, it } from 'vitest';
import {
  buildOtpEmail,
  buildPasswordResetEmail,
} from '../modules/email/email.templates';

/**
 * Email layout regressions.
 *
 * These assert on the STRUCTURE of the generated HTML, not on pixel
 * rendering — but the structure is what determines the rendering in
 * email clients, and it is exactly what broke before: the code boxes
 * were joined with a row-closing tag, so every digit landed on its own
 * line and the boxes stacked vertically instead of forming a row.
 */

/** Extract the table that holds the code boxes. */
function codeTable(html: string): string {
  const marker = html.indexOf('Enter this code');
  const from = html.indexOf('<table', marker === -1 ? 0 : marker);
  const to = html.indexOf('</table>', from) + '</table>'.length;
  return html.slice(from, to);
}

describe('The code boxes form a single horizontal row', () => {
  it('puts all six OTP digits in ONE table row', () => {
    const { html } = buildOtpEmail({
      name: 'Tahsin Rahman',
      otp: '439851',
      expiresInMinutes: 5,
    });
    const table = codeTable(html);

    // ONE row, SIX cells.
    expect(table.match(/<tr>/g) ?? []).toHaveLength(1);
    expect(table.match(/<td[\s>]/g) ?? []).toHaveLength(6);
  });

  it('puts all six reset-code digits in ONE table row', () => {
    const { html } = buildPasswordResetEmail({
      name: 'Tahsin Rahman',
      code: '123456',
      resetUrl: 'http://localhost:3000/reset-password?code=123456',
      expiresInMinutes: 15,
    });
    const table = codeTable(html);

    expect(table.match(/<tr>/g) ?? []).toHaveLength(1);
    expect(table.match(/<td[\s>]/g) ?? []).toHaveLength(6);
  });

  it('does not inject a row break between digits', () => {
    const { html } = buildOtpEmail({
      name: 'Tahsin Rahman',
      otp: '439851',
      expiresInMinutes: 5,
    });
    const table = codeTable(html);

    // The old bug joined cells with '</tr><tr>'.
    expect(table).not.toContain('</tr><tr>');
    // Every digit appears exactly once, in order.
    expect(table).toContain('>4<');
    expect(table).toContain('>3<');
    expect(table).toContain('>9<');
    expect(table).toContain('>8<');
    expect(table).toContain('>5<');
    expect(table).toContain('>1<');
  });
});

describe('Email-client-safe markup', () => {
  it('uses no flexbox, CSS variables or grid in the code table', () => {
    const { html } = buildOtpEmail({
      name: 'Tahsin Rahman',
      otp: '439851',
      expiresInMinutes: 5,
    });
    const table = codeTable(html);

    expect(table).not.toContain('display:flex');
    expect(table).not.toContain('display:flex');
    expect(table).not.toContain('display:grid');
    expect(table).not.toContain('var(--');
    // Every cell carries its own inline styles.
    expect(table).not.toContain('<style');
  });

  it('escapes a hostile name', () => {
    const { html } = buildOtpEmail({
      name: '<script>alert(1)</script>',
      otp: '439851',
      expiresInMinutes: 5,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
