/**
 * New-purchase form (stock intake from a supplier). Builds the
 * POST /api/purchases body; the server computes totals and posts stock,
 * metal pools and the supplier account.
 */
import { normalizeDecimalInput } from '@/services/finance';

export interface PurchaseLine {
  key: string;
  kind: 'product' | 'metal';
  productId: number | '';
  quantity: number;
  unitCost: string;
  karat: number;
  weightGrams: string;
  totalCost: string;
}

export interface PurchaseForm {
  supplierId: number | '';
  invoiceNo: string;
  lines: PurchaseLine[];
  paymentMethod: string;
  paymentAmount: string;
  key: string;
}

type ProductLinePayload = { productId: number; quantity: number; unitCost: string };
type MetalLinePayload = { metal: 'XAU'; karat: number; weightGrams: string; totalCost: string };

export interface PurchasePayload {
  supplierId: number;
  invoiceNo?: string;
  lines: Array<ProductLinePayload | MetalLinePayload>;
  payments?: Array<{ method: string; amount: string }>;
}

let seq = 0;

export function purchaseLine(): PurchaseLine {
  seq += 1;
  return { key: `pl${seq}`, kind: 'product', productId: '', quantity: 1, unitCost: '', karat: 22, weightGrams: '', totalCost: '' };
}

export function emptyPurchase(supplierId: number | '' = ''): PurchaseForm {
  return { supplierId, invoiceNo: '', lines: [purchaseLine()], paymentMethod: 'havale', paymentAmount: '', key: '' };
}

export function purchasePayload(form: PurchaseForm): PurchasePayload {
  const lines = form.lines.map((l): ProductLinePayload | MetalLinePayload => (l.kind === 'metal'
    ? { metal: 'XAU', karat: l.karat, weightGrams: normalizeDecimalInput(l.weightGrams), totalCost: normalizeDecimalInput(l.totalCost) }
    : { productId: Number(l.productId), quantity: Number(l.quantity) || 0, unitCost: normalizeDecimalInput(l.unitCost) }));
  const payload: PurchasePayload = { supplierId: Number(form.supplierId), invoiceNo: form.invoiceNo || undefined, lines };
  const paid = normalizeDecimalInput(form.paymentAmount);
  if (paid) payload.payments = [{ method: form.paymentMethod, amount: paid }];
  return payload;
}
