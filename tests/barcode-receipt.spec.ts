import { describe, expect, it } from 'vitest';
import { addScannedProduct, code128Modules, code128Svg, code128Values, resolveScan } from '@/services/barcode';
import { buildReceiptHtml } from '@/services/receipt';

const products = [
  { _id: 1, name: 'Bilezik', barcode: '8690001', sku: 'BLZ-22', stock: 2 },
  { _id: 2, name: 'Kolye', barcode: 'abc-9', stock: 0 },
  { _id: 3, name: 'Eski', barcode: '111', stock: 5, isArchived: true },
];
const newLine = () => ({ productId: '' as number | '', quantity: 1, key: Math.random() });

describe('barcode scanning', () => {
  it('matches barcode, then SKU, case-insensitively; ignores archived products', () => {
    expect(resolveScan(products, ' 8690001 ')).toMatchObject({ status: 'found', product: { _id: 1 } });
    expect(resolveScan(products, 'blz-22')).toMatchObject({ status: 'found', product: { _id: 1 } });
    expect(resolveScan(products, 'ABC-9')).toMatchObject({ status: 'out_of_stock' });
    expect(resolveScan(products, '111')).toMatchObject({ status: 'not_found' });
    expect(resolveScan(products, '   ')).toEqual({ status: 'empty' });
  });

  it('fills an empty line, increments an existing one and never exceeds stock', () => {
    const lines = [newLine()];
    expect(addScannedProduct(lines, products[0], newLine)).toEqual({ index: 0, capped: false });
    expect(lines[0]).toMatchObject({ productId: 1, quantity: 1 });
    addScannedProduct(lines, products[0], newLine);
    expect(lines[0].quantity).toBe(2);
    expect(addScannedProduct(lines, products[0], newLine)).toEqual({ index: 0, capped: true });
    expect(lines[0].quantity).toBe(2);
    addScannedProduct(lines, { _id: 9, name: 'Yeni', stock: 4 }, newLine);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ productId: 9, quantity: 1 });
  });
});

describe('Code 128 (subset B)', () => {
  it('every symbol pattern is well-formed: 11 modules, even bar count, all distinct', () => {
    // Encode every printable ASCII character to touch the data patterns 0–94.
    const all = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    const values = code128Values(all);
    const modules = code128Modules(all);
    expect(values[0]).toBe(104);
    expect(values[values.length - 1]).toBe(106);
    // data symbols + start + checksum = 6 widths each, stop = 7 widths
    expect(modules.length).toBe((values.length - 1) * 6 + 7);
    const symbols = modules.slice(0, -7).match(/.{6}/g) as string[];
    for (const s of symbols) {
      const w = [...s].map(Number);
      expect(w.reduce((a, b) => a + b, 0)).toBe(11);
      expect((w[0] + w[2] + w[4]) % 2).toBe(0);
    }
    expect(new Set(symbols.slice(1, 96)).size).toBe(95);
    expect([...modules.slice(-7)].map(Number).reduce((a, b) => a + b, 0)).toBe(13);
  });

  it('computes the modulo-103 checksum', () => {
    // "Wikipedia": 104 + 55·1 + 73·2 + 75·3 + 73·4 + 80·5 + 69·6 + 68·7 + 73·8 + 65·9 = 3281 → 3281 mod 103 = 88
    const values = code128Values('Wikipedia');
    expect(values[values.length - 2]).toBe(88);
  });

  it('rejects unsupported input and escapes the label text', () => {
    expect(() => code128Values('')).toThrow();
    expect(() => code128Values('ç')).toThrow();
    const svg = code128Svg('A<B');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('A&lt;B');
    expect(svg).not.toContain('A<B');
  });
});

describe('receipt', () => {
  const labels = {
    title: 'Satış fişi', saleNo: 'No', date: 'Tarih', customer: 'Müşteri', product: 'Ürün', quantity: 'Adet',
    total: 'Toplam', subtotal: 'Ara toplam', discount: 'İndirim', vatIncluded: 'KDV dahil', paid: 'Ödenen',
    balanceDue: 'Kalan', taxOffice: 'V.D.', taxNumber: 'VKN', notInvoice: 'Mali değeri yoktur',
  };
  const fmt = { money: (v: number) => `${v.toFixed(2)} TL`, date: () => '10.11.2026', number: (v: number) => String(v) };

  it('prints identity, lines, totals and the KDV breakdown, escaping all text', () => {
    const html = buildReceiptHtml({
      _id: 42, date: '2026-11-10', customerName: '<script>x</script>',
      lines: [
        { productName: 'Bilezik', quantity: 1, total: 62409.66, vat: { vat: 382.82, rate: 20 } },
        { productName: 'Kolye', quantity: 1, total: 1500, vat: { vat: 250, rate: 20 } },
      ],
      financial: { total: 63909.66, paid: 63909.66, balanceDue: 0, vat: 632.82 },
    }, { companyName: 'Test Kuyumculuk', taxOffice: 'Fatih', taxNumber: '1234567890', receiptFooter: 'Teşekkürler' }, labels, fmt);
    expect(html).toContain('Test Kuyumculuk');
    expect(html).toContain('VKN: 1234567890');
    expect(html).toContain('63909.66 TL');
    expect(html).toContain('KDV dahil %20');
    expect(html).toContain('632.82 TL');
    expect(html).toContain('Mali değeri yoktur');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
