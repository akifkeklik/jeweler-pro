/**
 * Product shelf/tag label (50 × 30 mm): name, price and a Code 128 barcode.
 */
import { code128Svg } from '@/services/barcode';
import { escapeHtml, printDocument } from '@/services/print';

export interface LabelProduct {
  name: string;
  barcode?: string | null;
  sku?: string | null;
  price?: number;
  pricingMode?: 'fixed' | 'gram';
}

export type LabelResult = { ok: true; html: string } | { ok: false; reason: 'no_code' | 'invalid_code'; code: string };

/** Builds the label document; gram-priced items print without a fixed price. */
export function buildLabelHtml(product: LabelProduct, formatPrice: (value: number) => string): LabelResult {
  const code = String(product.barcode || product.sku || '').trim();
  if (!code) return { ok: false, reason: 'no_code', code };
  let svg: string;
  try {
    svg = code128Svg(code, { moduleWidth: 1.6, height: 48 });
  } catch {
    // Code 128 B covers printable ASCII only (no Turkish letters).
    return { ok: false, reason: 'invalid_code', code };
  }
  const price = product.pricingMode === 'gram' || product.price === undefined ? '' : formatPrice(product.price);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(product.name)}</title>
<style>@page { size: 50mm 30mm; margin: 2mm; } body { margin: 0; font-family: system-ui, sans-serif; text-align: center; }
.n { font-size: 10px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .p { font-size: 11px; } svg { max-width: 100%; height: auto; }</style>
</head><body><div class="n">${escapeHtml(product.name)}</div>${price ? `<div class="p">${escapeHtml(price)}</div>` : ''}${svg}</body></html>`;
  return { ok: true, html };
}

export function printLabel(product: LabelProduct, formatPrice: (value: number) => string): LabelResult {
  const result = buildLabelHtml(product, formatPrice);
  if (result.ok) printDocument(result.html);
  return result;
}
