import { describe, expect, it } from 'vitest';
import { emptyPurchase, purchaseLine, purchasePayload } from '@/services/purchaseForm';

describe('new purchase payload', () => {
  it('sends product lines with a normalised unit cost and no payment when none is given', () => {
    const form = emptyPurchase(7);
    Object.assign(form.lines[0], { productId: 12, quantity: 3, unitCost: '1.500,00' });
    expect(purchasePayload(form)).toEqual({
      supplierId: 7,
      invoiceNo: undefined,
      lines: [{ productId: 12, quantity: 3, unitCost: '1500.00' }],
    });
  });

  it('sends fine-gold scrap lines and an up-front payment', () => {
    const form = { ...emptyPurchase(7), invoiceNo: 'A-1', paymentMethod: 'nakit', paymentAmount: '250,5' };
    form.lines = [{ ...purchaseLine(), kind: 'metal', karat: 14, weightGrams: '10,25', totalCost: '25000' }];
    expect(purchasePayload(form)).toEqual({
      supplierId: 7,
      invoiceNo: 'A-1',
      lines: [{ metal: 'XAU', karat: 14, weightGrams: '10.25', totalCost: '25000' }],
      payments: [{ method: 'nakit', amount: '250.5' }],
    });
  });

  it('gives every line its own key', () => {
    expect(purchaseLine().key).not.toBe(purchaseLine().key);
  });
});
