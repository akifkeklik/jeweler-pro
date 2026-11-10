import { normalizeDecimalInput } from '@/services/finance';

/**
 * Manual metal prices of a sale. The API resolves the price of every
 * gram-priced line from `manualPrices[<that product's metal>]` (else from a
 * live quote), so a cart with gold and silver lines needs one manual price
 * per metal — keyed by the metal code, never by a fixed "XAU".
 */
export type MetalCode = 'XAU' | 'XAG';
export const METAL_CODES: readonly MetalCode[] = ['XAU', 'XAG'];

export function isMetalCode(value: unknown): value is MetalCode {
  return (METAL_CODES as readonly unknown[]).includes(value);
}

interface ProductLike {
  pricingMode?: string;
  metal?: string;
}

/** Metals of the gram-priced products in the cart, in a stable order (XAU, XAG). */
export function gramMetalsOf(
  lines: Array<{ productId?: unknown }>,
  productById: (id: unknown) => ProductLike | undefined | null,
): MetalCode[] {
  const present = new Set<MetalCode>();
  for (const line of lines) {
    if (!line?.productId) continue;
    const product = productById(line.productId);
    if (product?.pricingMode === 'gram' && isMetalCode(product.metal)) present.add(product.metal);
  }
  return METAL_CODES.filter((metal) => present.has(metal));
}

/**
 * `manualPrices` for the API: only metals that are in the cart AND have a
 * typed price (a leftover price for a metal that is no longer in the cart
 * is not sent). Returns undefined when there is nothing to send.
 */
export function manualPricesPayload(
  metals: readonly MetalCode[],
  inputs: Partial<Record<MetalCode, unknown>>,
): Partial<Record<MetalCode, string>> | undefined {
  const out: Partial<Record<MetalCode, string>> = {};
  for (const metal of metals) {
    const value = normalizeDecimalInput(inputs?.[metal]);
    if (value) out[metal] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Price snapshot of a quoted gram line (see backend salesService snapshotOf). */
export interface QuotedPrice {
  priceType?: 'live' | 'manual';
  pricePerGram?: string;
  source?: string;
  sourceTimestamp?: string;
  [key: string]: unknown;
}

/** Price snapshot the quote used for each metal (first gram line of that metal). */
export function quotedMetalPrices(
  quoteLines: Array<{ pricingMode?: string; metal?: string; price?: QuotedPrice }> | undefined,
): Partial<Record<MetalCode, QuotedPrice>> {
  const out: Partial<Record<MetalCode, QuotedPrice>> = {};
  for (const line of quoteLines || []) {
    if (line?.pricingMode === 'gram' && isMetalCode(line.metal) && line.price && !out[line.metal]) out[line.metal] = line.price;
  }
  return out;
}
