/**
 * Sale receipt (satış fişi) for an 80 mm thermal printer or A4.
 *
 * NOTE: this is an internal sales slip, not a legal invoice. In Turkey the
 * legal document is the e-Arşiv fatura / ÖKC fişi issued through an
 * authorised provider (see docs/FISCAL_INTEGRATION.md); the slip says so.
 */
import { escapeHtml } from '@/services/print';
import type { BusinessProfile } from '@/services/businessProfile';

export interface ReceiptLabels {
  title: string;
  saleNo: string;
  date: string;
  customer: string;
  product: string;
  quantity: string;
  total: string;
  subtotal: string;
  discount: string;
  vatIncluded: string;
  paid: string;
  balanceDue: string;
  taxOffice: string;
  taxNumber: string;
  notInvoice: string;
}

export interface ReceiptFormatters {
  money: (value: number) => string;
  date: (value: string | Date) => string;
  number: (value: number) => string;
}

interface SaleLike {
  _id: number | string;
  date: string | Date;
  customerName?: string;
  totalPrice?: number;
  lines?: Array<{ productName?: string; quantity: number; total: number; vat?: { vat: number; rate: number } }>;
  financial?: { total?: number; subtotal?: number; discount?: number; paid?: number; balanceDue?: number; vat?: number | null };
}

export function buildReceiptHtml(sale: SaleLike, profile: Partial<BusinessProfile>, labels: ReceiptLabels, fmt: ReceiptFormatters): string {
  const f = sale.financial || {};
  const total = f.total ?? sale.totalPrice ?? 0;
  const lines = sale.lines || [];
  const row = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ''}><td>${escapeHtml(label)}</td><td class="r">${escapeHtml(value)}</td></tr>`;

  const vatByRate = new Map<number, number>();
  for (const l of lines) {
    if (l.vat && l.vat.vat > 0) vatByRate.set(l.vat.rate, (vatByRate.get(l.vat.rate) || 0) + l.vat.vat);
  }

  const header = [
    profile.companyName ? `<div class="company">${escapeHtml(profile.companyName)}</div>` : '',
    profile.address ? `<div>${escapeHtml(profile.address)}</div>` : '',
    profile.phone ? `<div>${escapeHtml(profile.phone)}</div>` : '',
    profile.taxOffice || profile.taxNumber
      ? `<div>${escapeHtml(labels.taxOffice)}: ${escapeHtml(profile.taxOffice || '—')} · ${escapeHtml(labels.taxNumber)}: ${escapeHtml(profile.taxNumber || '—')}</div>`
      : '',
  ].join('');

  const items = lines.map((l) => `<tr><td>${escapeHtml(l.productName || '')}<div class="muted">${escapeHtml(fmt.number(l.quantity))} ×</div></td><td class="r">${escapeHtml(fmt.money(l.total))}</td></tr>`).join('');

  const totals = [
    f.subtotal !== undefined && f.discount ? row(labels.subtotal, fmt.money(f.subtotal)) : '',
    f.discount ? row(labels.discount, `−${fmt.money(f.discount)}`) : '',
    row(labels.total, fmt.money(total), true),
    ...[...vatByRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, vat]) => row(`${labels.vatIncluded} %${fmt.number(rate)}`, fmt.money(vat))),
    f.paid !== undefined ? row(labels.paid, fmt.money(f.paid)) : '',
    f.balanceDue ? row(labels.balanceDue, fmt.money(f.balanceDue), true) : '',
  ].join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(labels.title)} #${escapeHtml(sale._id)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #000; margin: 0; }
  .center { text-align: center; } .company { font-size: 15px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; } td { padding: 2px 0; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; } .muted { color: #555; font-size: 11px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; } .strong td { font-weight: 700; font-size: 13px; }
  .note { font-size: 10px; text-align: center; margin-top: 6px; }
</style></head><body>
<div class="center">${header}</div><hr>
<div>${escapeHtml(labels.title)} · ${escapeHtml(labels.saleNo)}: ${escapeHtml(sale._id)}</div>
<div>${escapeHtml(labels.date)}: ${escapeHtml(fmt.date(sale.date))}</div>
${sale.customerName ? `<div>${escapeHtml(labels.customer)}: ${escapeHtml(sale.customerName)}</div>` : ''}
<hr><table>${items}</table><hr><table>${totals}</table>
${profile.receiptFooter ? `<hr><div class="center">${escapeHtml(profile.receiptFooter)}</div>` : ''}
<div class="note">${escapeHtml(labels.notInvoice)}</div>
</body></html>`;
}
