/**
 * Transfer commands and line arithmetic: parses create / receive / resolve
 * payloads and splits dispatched quantities, weights, fine content and cost
 * into cumulative proportional portions, so goods in transit always clear
 * to exactly zero.
 */
const {
  parseDecimal, roundDiv, toSafeInteger, toDisplayNumber,
} = require('../../domain/decimal');
const { SCALE, LIMITS, ROUNDING_MODE } = require('../../domain/precision');
const { resolvePurity, fineWeightMg, assertMetal } = require('../../domain/metals');
const { badRequest, conflict, parseNumericId } = require('../finance/core');

const MAX_LINES = 100;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);

/* ------------------------------------------------------------------ input */

function parseTransferCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('Geçerli bir transfer bilgisi gönderilmelidir');
  if (!Array.isArray(payload.lines) || !payload.lines.length) throw badRequest('Transferde en az bir satır olmalıdır');
  if (payload.lines.length > MAX_LINES) throw badRequest(`Bir transferde en fazla ${MAX_LINES} satır olabilir`);
  const seen = new Set();
  const lines = payload.lines.map((raw, index) => {
    const lineId = index + 1;
    if (!raw || typeof raw !== 'object') throw badRequest(`${lineId}. satır geçersiz`);
    if (raw.metal) {
      const metal = assertMetal(raw.metal);
      const purity = resolvePurity(raw);
      const weightMg = parseDecimal(raw.weightGrams, SCALE.WEIGHT, { field: 'Gramaj', allowZero: false, max: LIMITS.MAX_WEIGHT_MG });
      const key = `metal:${metal}:${purity}`;
      if (seen.has(key)) throw badRequest('Aynı maden/ayar havuzu bir transferde yalnızca bir kez yer alabilir', 'DUPLICATE_TRANSFER_LINE');
      seen.add(key);
      return { lineId, itemType: 'metal', metal, purity, weightMg, fineMg: fineWeightMg(weightMg, purity) };
    }
    const productId = parseNumericId(raw.productId, 'ürün');
    const quantity = Number(raw.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > LIMITS.MAX_QUANTITY) {
      throw badRequest('Transfer miktarı pozitif bir tam sayı olmalıdır', 'INVALID_QUANTITY');
    }
    const key = `product:${productId}`;
    if (seen.has(key)) throw badRequest('Aynı ürün bir transferde yalnızca bir kez yer alabilir', 'DUPLICATE_TRANSFER_LINE');
    seen.add(key);
    const destinationProductId = raw.destinationProductId === undefined || raw.destinationProductId === null || raw.destinationProductId === ''
      ? null : parseNumericId(raw.destinationProductId, 'hedef ürün');
    return { lineId, itemType: 'product', productId, quantity, destinationProductId };
  });
  return {
    sourceBranch: text(payload.sourceBranch, 120),
    destinationBranch: text(payload.destinationBranch, 120),
    lines,
    notes: text(payload.notes, 1000),
  };
}

/**
 * Receipt / resolution quantities: { lineId, quantity } for products,
 * { lineId, weightGrams } for metal. Missing amount = everything outstanding.
 */
function parseLineAmounts(rawLines, transfer, { requireAmount }) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw badRequest('En az bir satır belirtilmelidir');
  const seen = new Set();
  return rawLines.map((raw) => {
    const lineId = Number(raw?.lineId);
    const line = transfer.lines.find((l) => l.lineId === lineId);
    if (!line) throw badRequest(`Transfer satırı bulunamadı: ${raw?.lineId}`, 'TRANSFER_LINE_NOT_FOUND');
    if (seen.has(lineId)) throw badRequest('Aynı satır bir istekte yalnızca bir kez yer alabilir', 'DUPLICATE_TRANSFER_LINE');
    seen.add(lineId);
    const out = outstandingOf(line);
    let amount;
    if (line.itemType === 'product') {
      if (raw.quantity === undefined || raw.quantity === null || raw.quantity === '') {
        if (requireAmount) throw badRequest('Teslim alınan miktar girilmelidir', 'INVALID_QUANTITY');
        amount = out.quantity;
      } else {
        amount = Number(raw.quantity);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw badRequest('Miktar pozitif bir tam sayı olmalıdır', 'INVALID_QUANTITY');
      }
      if (amount > out.quantity) {
        throw conflict(`${line.productName}: en fazla ${out.quantity} adet bekliyor (istenen ${amount})`, 'EXCEEDS_OUTSTANDING', {
          lineId, outstanding: out.quantity, requested: amount,
        });
      }
    } else {
      if (raw.weightGrams === undefined || raw.weightGrams === null || raw.weightGrams === '') {
        if (requireAmount) throw badRequest('Teslim alınan gramaj girilmelidir', 'INVALID_QUANTITY');
        amount = out.weightMg;
      } else {
        amount = toSafeInteger(parseDecimal(raw.weightGrams, SCALE.WEIGHT, { field: 'Gramaj', allowZero: false, max: LIMITS.MAX_WEIGHT_MG }));
      }
      if (amount > out.weightMg) {
        throw conflict(`${line.metal} ${line.purity / 10}‰: en fazla ${toDisplayNumber(BigInt(out.weightMg), 3)} gr bekliyor`, 'EXCEEDS_OUTSTANDING', {
          lineId, outstandingWeightMg: out.weightMg, requestedWeightMg: amount,
        });
      }
    }
    if (amount <= 0) throw conflict('Bu satırda bekleyen miktar yok', 'NOTHING_OUTSTANDING', { lineId });
    return { line, amount };
  });
}

/* --------------------------------------------------------- line arithmetic */

const settled = (line, field) => (line.received?.[field] || 0) + (line.returned?.[field] || 0) + (line.writtenOff?.[field] || 0);

function outstandingOf(line) {
  const d = line.dispatched || {};
  return {
    quantity: (d.quantity || 0) - settled(line, 'quantity'),
    weightMg: (d.weightMg || 0) - settled(line, 'weightMg'),
    fineMg: (d.fineMg || 0) - settled(line, 'fineMg'),
  };
}

/** Cumulative share of `total` for `part` out of `whole` (whole → total exactly). */
function share(total, part, whole) {
  if (total === null || total === undefined) return null;
  if (part >= whole) return BigInt(total);
  return roundDiv(BigInt(total) * BigInt(part), BigInt(whole), ROUNDING_MODE);
}

/**
 * The next `amount` (pieces or mg) of a dispatched line: quantity, weight,
 * fine and cost, computed as the difference of cumulative shares so that
 * all portions together are exactly the dispatched figures.
 */
function portionOf(line, amount) {
  const d = line.dispatched;
  if (line.itemType === 'product') {
    const before = settled(line, 'quantity');
    const cost = d.costMinor === null ? null : share(d.costMinor, before + amount, d.quantity) - share(d.costMinor, before, d.quantity);
    return { quantity: amount, weightMg: 0, fineMg: 0, costMinor: cost };
  }
  const before = settled(line, 'weightMg');
  const fine = share(d.fineMg, before + amount, d.weightMg) - share(d.fineMg, before, d.weightMg);
  const cost = d.costMinor === null ? null : share(d.costMinor, before + amount, d.weightMg) - share(d.costMinor, before, d.weightMg);
  return { quantity: 0, weightMg: amount, fineMg: toSafeInteger(fine), costMinor: cost };
}

function addTo(bucket, portion) {
  const cost = portion.costMinor === null || bucket.costMinor === null
    ? null
    : toSafeInteger(BigInt(bucket.costMinor || 0) + portion.costMinor);
  return {
    quantity: (bucket.quantity || 0) + portion.quantity,
    weightMg: (bucket.weightMg || 0) + portion.weightMg,
    fineMg: (bucket.fineMg || 0) + portion.fineMg,
    costMinor: cost,
  };
}

const isFullySettled = (transfer) => transfer.lines.every((line) => {
  const out = outstandingOf(line);
  return out.quantity === 0 && out.weightMg === 0;
});

/* ------------------------------------------------------------- guards */

module.exports = {
  text, parseTransferCommand, parseLineAmounts, settled, outstandingOf, share, portionOf, addTo, isFullySettled,
};
