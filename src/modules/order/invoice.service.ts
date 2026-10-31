import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import type { OrderDoc } from './order.interface';
import type { PublicOrderPayment } from './orderPayment.interface';

const BDT = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 0,
});

/** A populated customer sub-document (name/phone/email after .populate). */
interface PopulatedCustomer {
  name?: string;
  phone?: string | null;
  email?: string | null;
}

type InvoiceOrder = Omit<OrderDoc, 'customer' | 'paymentMethod'> & {
  customer?: PopulatedCustomer;
  paymentMethod?: { name?: string } | null;
};

function fmtDate(d: Date | string | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateTime(d: Date | string | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface StreamInvoiceOptions {
  /** When true, appends a payments log at the bottom. Admin only. */
  includePaymentsLog: boolean;
  /** OrderPayment rows to render in the log. */
  payments?: PublicOrderPayment[];
}

export function streamInvoice(
  res: Response,
  order: InvoiceOrder,
  options: StreamInvoiceOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Invoice ${order.invoiceNumber ?? order.orderNumber}`,
          Author: 'First Sniffer',
          Subject: `Order ${order.orderNumber}`,
        },
      });

      const filename = `Invoice-${order.invoiceNumber ?? order.orderNumber}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );

      doc.on('error', (err: Error) => reject(err));
      doc.on('end', () => resolve());
      doc.pipe(res);

      drawInvoice(doc, order, options);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawInvoice(
  doc: PDFKit.PDFDocument,
  order: InvoiceOrder,
  { includePaymentsLog, payments }: StreamInvoiceOptions
): void {
  const pageWidth = doc.page.width;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  /* ----- Header ----- */
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor('#111111')
    .text('First Sniffer', margin, margin);

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#666666')
    .text('hello@firstsniffer.bd', margin, margin + 26);

  // Right-side invoice label
  doc
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor('#111111')
    .text('INVOICE', margin, margin, {
      width: contentWidth,
      align: 'right',
    });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#666666')
    .text(`Invoice #: ${order.invoiceNumber ?? '—'}`, margin, margin + 30, {
      width: contentWidth,
      align: 'right',
    })
    .text(`Order #: ${order.orderNumber}`, margin, margin + 42, {
      width: contentWidth,
      align: 'right',
    })
    .text(`Issued: ${fmtDate(order.createdAt)}`, margin, margin + 54, {
      width: contentWidth,
      align: 'right',
    });

  /* ----- Divider ----- */
  const dividerY = margin + 90;
  doc
    .moveTo(margin, dividerY)
    .lineTo(pageWidth - margin, dividerY)
    .lineWidth(0.5)
    .strokeColor('#E5E5E5')
    .stroke();

  /* ----- Bill to ----- */
  const billY = dividerY + 16;
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#888888')
    .text('BILL TO', margin, billY, { characterSpacing: 1.5 });

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111111')
    .text(order.customer?.name ?? 'Customer', margin, billY + 14);

  doc.font('Helvetica').fontSize(9).fillColor('#444444');

  const addr = order.shippingAddress;
  const phone = order.customer?.phone;
  let nextY = billY + 30;
  if (addr?.address) {
    doc.text(addr.address, margin, nextY, { width: contentWidth / 2 });
    nextY = doc.y + 2;
  }
  if (addr?.area || addr?.district) {
    const tail = [addr?.area, addr?.district].filter(Boolean).join(', ');
    doc.text(tail, margin, nextY, { width: contentWidth / 2 });
    nextY = doc.y + 2;
  }
  if (phone) {
    doc.text(String(phone), margin, nextY);
    nextY = doc.y + 2;
  }
  if (order.customer?.email) {
    doc.text(String(order.customer.email), margin, nextY);
    nextY = doc.y + 2;
  }

  /* ----- Items table ----- */
  const tableTop = Math.max(nextY + 20, billY + 100);
  drawTableHeader(doc, margin, tableTop, contentWidth, [
    'Item',
    'Size',
    'Qty',
    'Unit',
    'Total',
  ]);
  let rowY = tableTop + 22;

  if (order.items.length === 0 && order.combos.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#888888')
      .text('No items', margin + 8, rowY + 4);
    rowY += 22;
  }

  for (const item of order.items) {
    if (rowY > doc.page.height - 200) {
      doc.addPage();
      rowY = margin;
    }
    const name = item.productSnapshot?.name ?? 'Item';
    drawTableRow(doc, margin, rowY, contentWidth, [
      name,
      String(item.size),
      `${item.millilitres}ml`,
      BDT.format(item.unitPrice),
      BDT.format(item.totalPrice),
    ]);
    rowY += 22;
  }

  for (const combo of order.combos) {
    if (rowY > doc.page.height - 200) {
      doc.addPage();
      rowY = margin;
    }
    drawTableRow(doc, margin, rowY, contentWidth, [
      `Combo: ${combo.name}`,
      '—',
      `×${combo.quantity}`,
      BDT.format(combo.unitPrice),
      BDT.format(combo.totalPrice),
    ]);
    rowY += 22;
  }

  // Footer rule under the table
  rowY += 4;
  doc
    .moveTo(margin, rowY)
    .lineTo(pageWidth - margin, rowY)
    .lineWidth(0.5)
    .strokeColor('#E5E5E5')
    .stroke();
  rowY += 14;

  /* ----- Totals block (right-aligned) ----- */
  const totalsLeft = pageWidth - margin - 200;
  const totalsValueX = pageWidth - margin;
  const lineH = 16;

  const drawTotalLine = (
    label: string,
    value: string,
    opts: { bold?: boolean; color?: string } = {}
  ): void => {
    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(opts.bold ? 11 : 10)
      .fillColor(opts.color ?? '#444444')
      .text(label, totalsLeft, rowY, { width: 120, align: 'right' });
    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(opts.bold ? 11 : 10)
      .fillColor(opts.color ?? '#111111')
      .text(value, totalsValueX - 80, rowY, { width: 80, align: 'right' });
    rowY += opts.bold ? lineH + 2 : lineH;
  };

  drawTotalLine('Subtotal', BDT.format(order.subtotal));
  if (order.discount > 0) {
    drawTotalLine(
      order.couponCode ? `Discount (${order.couponCode})` : 'Discount',
      `- ${BDT.format(order.discount)}`
    );
  }
  if (order.shippingCharge > 0) {
    drawTotalLine('Shipping', BDT.format(order.shippingCharge));
  }

  // Divider before total
  doc
    .moveTo(totalsLeft, rowY - 2)
    .lineTo(totalsValueX, rowY - 2)
    .lineWidth(0.5)
    .strokeColor('#E5E5E5')
    .stroke();
  rowY += 4;

  drawTotalLine('Total', BDT.format(order.total), { bold: true });

  const paid = order.paidAmount ?? 0;
  drawTotalLine('Paid', BDT.format(paid), {
    color: paid > 0 ? '#0F766E' : '#444444',
  });

  const due = Math.max(0, order.total - paid);
  if (paid > order.total) {
    drawTotalLine('Overpaid', BDT.format(paid - order.total), {
      color: '#0F766E',
    });
    drawTotalLine('Due', BDT.format(0), { color: '#0F766E', bold: true });
  } else {
    drawTotalLine('Due', BDT.format(due), {
      bold: true,
      color: due === 0 ? '#0F766E' : '#B91C1C',
    });
  }

  /* ----- Payment status pill ----- */
  rowY += 8;
  const status = order.paymentStatus ?? 'unpaid';
  const statusLabels: Record<string, string> = {
    unpaid: 'Unpaid',
    pending_verification: 'Awaiting verification',
    paid: 'Paid',
    refunded: 'Refunded',
    failed: 'Failed',
  };
  const statusColors: Record<string, string> = {
    unpaid: '#B91C1C',
    pending_verification: '#B45309',
    paid: '#0F766E',
    refunded: '#525252',
    failed: '#B91C1C',
  };
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(statusColors[status] ?? '#525252')
    .text(
      `PAYMENT STATUS: ${(statusLabels[status] ?? status).toUpperCase()}`,
      totalsLeft,
      rowY,
      { width: 200, align: 'right', characterSpacing: 1 }
    );

  /* ----- Payments log (admin only) ----- */
  if (includePaymentsLog && payments && payments.length > 0) {
    rowY += 36;
    if (rowY > doc.page.height - 120) {
      doc.addPage();
      rowY = margin;
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#888888')
      .text('PAYMENTS LOG', margin, rowY, { characterSpacing: 1.5 });
    rowY += 16;
    drawTableHeader(doc, margin, rowY, contentWidth, [
      'Date',
      'Amount',
      'Note',
      'Recorded by',
    ]);
    rowY += 22;
    for (const p of payments) {
      if (rowY > doc.page.height - 80) {
        doc.addPage();
        rowY = margin;
      }
      drawTableRow(
        doc,
        margin,
        rowY,
        contentWidth,
        [
          fmtDate(p.createdAt),
          BDT.format(p.amount),
          p.note ?? '—',
          p.createdBy?.name ?? '—',
        ],
        { ellipsisAt: 2 }
      );
      rowY += 22;
    }
  }

  /* ----- Footer ----- */
  const footerY = doc.page.height - 60;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#888888')
    .text('Thank you for your purchase.', margin, footerY, {
      width: contentWidth,
      align: 'center',
    })
    .text(`Generated ${fmtDateTime(new Date())}`, margin, footerY + 12, {
      width: contentWidth,
      align: 'center',
    });
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  cols: string[]
): void {
  const widths = computeColumnWidths(width, cols.length);
  let cx = x;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888');
  cols.forEach((label, i) => {
    doc.text(label.toUpperCase(), cx + 4, y, {
      width: widths[i] - 8,
      align: i === 0 ? 'left' : 'right',
      characterSpacing: 1.5,
      ellipsis: true,
    });
    cx += widths[i];
  });
  doc
    .moveTo(x, y + 14)
    .lineTo(x + width, y + 14)
    .lineWidth(0.5)
    .strokeColor('#E5E5E5')
    .stroke();
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  cols: string[],
  opts: { ellipsisAt?: number } = {}
): void {
  const widths = computeColumnWidths(width, cols.length);
  let cx = x;
  doc.font('Helvetica').fontSize(9).fillColor('#111111');
  cols.forEach((label, i) => {
    doc.text(label, cx + 4, y + 4, {
      width: widths[i] - 8,
      align: i === 0 ? 'left' : 'right',
      ellipsis: i === (opts.ellipsisAt ?? 0),
    });
    cx += widths[i];
  });
}

function computeColumnWidths(totalWidth: number, n: number): number[] {
  if (n === 4) {
    return [0.2, 0.2, 0.4, 0.2].map((r) => r * totalWidth);
  }
  // 5-column default for items: Item, Size, Qty, Unit, Total
  return [0.5, 0.12, 0.12, 0.13, 0.13].map((r) => r * totalWidth);
}
