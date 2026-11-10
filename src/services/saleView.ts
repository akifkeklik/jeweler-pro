/**
 * Presentation rules for a sale DTO (GET /api/sales). Shared by the sales list
 * and every sale dialog so a status, a total or a labour text reads the same
 * everywhere. Pure functions: no store, no API.
 */
import { t } from '@/i18n';
import { PAYMENT_STATUS_LABELS, SALE_STATUS_LABELS } from '@/services/finance';

export type PaymentStatus = 'paid' | 'partial' | 'unpaid' | 'refunded';
export type SaleStatus = 'completed' | 'cancelled' | 'partially_returned' | 'returned';

export interface SaleFinancial {
  journaled?: boolean;
  total: number;
  subtotal?: number;
  discount?: number;
  paid: number;
  returned: number;
  balanceDue: number;
  paymentStatus: PaymentStatus;
  vat?: number | null;
}

export interface SaleLineView {
  lineId: number;
  productName?: string;
  pricingMode?: 'fixed' | 'gram';
  quantity: number;
  returnedQuantity?: number;
  purity?: number;
  weightGramsPerUnit?: number;
  laborType?: 'none' | 'milyem' | 'per_gram' | 'fixed';
  laborValue?: string;
  price?: { priceType?: 'live' | 'manual'; pricePerGram?: string; source?: string };
  unitPrice: number;
  total: number;
  vat?: { vat: number; rate: number };
}

export interface SalePaymentView {
  kind?: 'payment' | 'refund';
  method: string;
  amount: number;
  at?: string;
}

export interface SaleView {
  _id: number;
  date: string;
  status?: SaleStatus;
  customerId?: number;
  customerName?: string;
  productName?: string;
  totalPrice?: number;
  paymentMethod?: string;
  notes?: string;
  lines?: SaleLineView[];
  payments?: SalePaymentView[];
  financial?: SaleFinancial;
}

/** Financial view; legacy sales (before the financial core) are fully paid. */
export function saleFinancial(sale: Partial<SaleView> | null | undefined): SaleFinancial {
  if (sale?.financial) return sale.financial;
  const total = sale?.totalPrice || 0;
  return { total, paid: total, balanceDue: 0, returned: 0, paymentStatus: 'paid' };
}

export function saleStatusLabel(sale: SaleView): string {
  if (sale.status && sale.status !== 'completed') return SALE_STATUS_LABELS[sale.status] || sale.status;
  return PAYMENT_STATUS_LABELS[saleFinancial(sale).paymentStatus] || t('status.sale.completed');
}

export function saleStatusBadge(sale: SaleView): string {
  if (sale.status === 'cancelled') return 'jp-badge-danger';
  if (sale.status === 'returned' || sale.status === 'partially_returned') return 'jp-badge-info';
  const status = saleFinancial(sale).paymentStatus;
  return status === 'partial' || status === 'unpaid' ? 'jp-badge-warning' : 'jp-badge-success';
}

/** A payment can be collected on a journaled, open sale with a balance. */
export function canCollect(sale: SaleView): boolean {
  return Boolean(sale.financial?.journaled) && sale.status !== 'cancelled' && saleFinancial(sale).balanceDue > 0;
}

/** Lines can be returned from a journaled sale that is not fully returned or cancelled. */
export function canReturn(sale: SaleView): boolean {
  return Boolean(sale.financial?.journaled) && Array.isArray(sale.lines) && ['completed', 'partially_returned'].includes(String(sale.status));
}

/** Labour of a gram-priced line, in the active language. */
export function laborText(line: Pick<SaleLineView, 'laborType' | 'laborValue'>): string {
  if (!line.laborType || line.laborType === 'none') return t('common.none');
  if (line.laborType === 'milyem') return `${line.laborValue}‰`;
  if (line.laborType === 'per_gram') return `${line.laborValue} ₺/${t('units.gram')}`;
  return `${line.laborValue} ₺`;
}

export function installmentText(count: number): string {
  return count === 1 ? t('sales.singlePayment') : t('sales.installments', { count });
}
