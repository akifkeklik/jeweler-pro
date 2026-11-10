/**
 * Customer account voucher (cari fiş): collection, payment, opening balance
 * or scrap-gold buy-back. Builds the POST /api/cash/transactions body; the
 * server computes every amount it can (e.g. scrap value from the live buy
 * price) and validates the rest.
 */
import { normalizeDecimalInput } from '@/services/finance';

export type VoucherType = 'tahsilat' | 'tediye' | 'devir' | 'hurda_alimi';

export interface VoucherForm {
  type: VoucherType;
  paymentMethod: string;
  direction: 'borc' | 'alacak';
  amountTry: string;
  amountGoldGrams: string;
  weightGrams: string;
  karat: number;
  deductionMilyem: string;
  manualPricePerGram: string;
  description: string;
}

export interface VoucherPayload {
  customerId: number;
  type: VoucherType;
  description: string;
  direction?: 'borc' | 'alacak';
  paymentMethod?: string;
  amountTry?: string;
  amountGoldGrams?: string;
  weightGrams?: string;
  karat?: number;
  deductionMilyem?: string;
  manualPricePerGram?: string;
}

export function emptyVoucher(): VoucherForm {
  return {
    type: 'tahsilat', paymentMethod: 'nakit', direction: 'borc', amountTry: '', amountGoldGrams: '',
    weightGrams: '', karat: 22, deductionMilyem: '', manualPricePerGram: '', description: '',
  };
}

export type VoucherResult =
  | { ok: true; payload: VoucherPayload }
  | { ok: false; reason: 'scrap_weight_required' | 'amount_required' };

export function buildVoucherPayload(customerId: number, form: VoucherForm): VoucherResult {
  const isScrap = form.type === 'hurda_alimi';
  const amountTry = normalizeDecimalInput(form.amountTry);
  const amountGold = normalizeDecimalInput(form.amountGoldGrams);
  if (isScrap && !normalizeDecimalInput(form.weightGrams)) return { ok: false, reason: 'scrap_weight_required' };
  if (!isScrap && !amountTry && !amountGold) return { ok: false, reason: 'amount_required' };

  const payload: VoucherPayload = { customerId, type: form.type, description: form.description };
  // An opening balance has a direction; every other voucher moves money through a payment method.
  if (form.type === 'devir') payload.direction = form.direction;
  else payload.paymentMethod = form.paymentMethod;
  if (amountTry) payload.amountTry = amountTry;
  if (!isScrap && amountGold) payload.amountGoldGrams = amountGold;
  if (isScrap) {
    payload.weightGrams = normalizeDecimalInput(form.weightGrams);
    payload.karat = form.karat;
    const deduction = normalizeDecimalInput(form.deductionMilyem);
    if (deduction) payload.deductionMilyem = deduction;
    const manual = normalizeDecimalInput(form.manualPricePerGram);
    if (manual) payload.manualPricePerGram = manual;
  }
  return { ok: true, payload };
}
