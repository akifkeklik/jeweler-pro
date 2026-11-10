/**
 * Barcode support.
 *
 * Scanning: USB/Bluetooth barcode scanners act as keyboards ("keyboard
 * wedge"): they type the code and press Enter. The sale screen keeps a scan
 * field focused; `resolveScan` finds the product, `addScannedProduct` puts it
 * in the cart (incrementing the quantity of an existing line).
 *
 * Labels: `code128Svg` renders a Code 128 (subset B) barcode as an SVG
 * string, so labels print on any printer without a font or a library.
 */

export interface ScannableProduct {
  _id: number;
  name: string;
  barcode?: string | null;
  sku?: string | null;
  stock?: number;
  isArchived?: boolean;
}

export interface CartLine {
  productId: number | '';
  quantity: number;
  [key: string]: unknown;
}

export type ScanResult =
  | { status: 'found'; product: ScannableProduct }
  | { status: 'not_found'; code: string }
  | { status: 'out_of_stock'; product: ScannableProduct }
  | { status: 'empty' };

const normalize = (code: unknown) => String(code ?? '').trim().toUpperCase();

/** Exact barcode match first, then SKU; archived products are never matched. */
export function resolveScan(products: ScannableProduct[], rawCode: unknown): ScanResult {
  const code = normalize(rawCode);
  if (!code) return { status: 'empty' };
  const active = products.filter((p) => !p.isArchived);
  const product = active.find((p) => normalize(p.barcode) === code) || active.find((p) => normalize(p.sku) === code);
  if (!product) return { status: 'not_found', code };
  if (typeof product.stock === 'number' && product.stock <= 0) return { status: 'out_of_stock', product };
  return { status: 'found', product };
}

/**
 * Adds one unit of `product` to the cart: increments its existing line,
 * otherwise fills the first empty line, otherwise appends a new line.
 * Returns the index of the affected line. Never exceeds the known stock.
 */
export function addScannedProduct(lines: CartLine[], product: ScannableProduct, makeLine: () => CartLine): { index: number; capped: boolean } {
  const existing = lines.findIndex((l) => l.productId === product._id);
  if (existing >= 0) {
    const next = (Number(lines[existing].quantity) || 0) + 1;
    const capped = typeof product.stock === 'number' && next > product.stock;
    lines[existing].quantity = capped ? product.stock as number : next;
    return { index: existing, capped };
  }
  const empty = lines.findIndex((l) => l.productId === '' || l.productId === null || l.productId === undefined);
  if (empty >= 0) {
    lines[empty].productId = product._id;
    lines[empty].quantity = 1;
    return { index: empty, capped: false };
  }
  const line = makeLine();
  line.productId = product._id;
  line.quantity = 1;
  lines.push(line);
  return { index: lines.length - 1, capped: false };
}

/* ------------------------------------------------------------ Code 128 B */

// Bar/space widths of the 107 Code 128 symbols (values 0–106; 106 = stop).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** Symbol values for `text` in subset B: start, data, checksum, stop. */
export function code128Values(text: string): number[] {
  const value = String(text ?? '');
  if (!value) throw new RangeError('BARCODE_EMPTY');
  const data = [...value].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new RangeError('BARCODE_UNSUPPORTED_CHARACTER');
    return code - 32;
  });
  const checksum = data.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...data, checksum, STOP];
}

/** Module widths (bar, space, bar, …) including the quiet zones. */
export function code128Modules(text: string): string {
  return code128Values(text).map((v) => PATTERNS[v]).join('');
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));

export function code128Svg(text: string, { moduleWidth = 2, height = 60, quiet = 10, showText = true } = {}): string {
  const widths = code128Modules(text);
  let x = quiet * moduleWidth;
  const bars: string[] = [];
  for (let i = 0; i < widths.length; i += 1) {
    const w = Number(widths[i]) * moduleWidth;
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
    x += w;
  }
  const total = x + quiet * moduleWidth;
  const textHeight = showText ? 16 : 0;
  const label = showText
    ? `<text x="${total / 2}" y="${height + 13}" text-anchor="middle" font-family="monospace" font-size="12">${escapeXml(text)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${height + textHeight}" viewBox="0 0 ${total} ${height + textHeight}" role="img" aria-label="${escapeXml(text)}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars.join('')}</g>${label}</svg>`;
}
