/**
 * Card / POS commission arithmetic (pure, BigInt fixed point).
 *
 * Rates are stored as parts per million (ppm) of the gross amount:
 *   1.79 %   → 17 900 ppm
 *   1.875 %  → 18 750 ppm
 * Input percentages are exact decimals with at most 4 fraction digits.
 *
 * commission = round_half_up(gross × ppm / 1 000 000) + fixed fee
 * Rounded ONCE per transaction; never more than the gross amount.
 */
const { parseDecimal, roundDiv } = require('./decimal');
const { ROUNDING_MODE } = require('./precision');

const PPM = 1_000_000n;
const MAX_RATE_PPM = 1_000_000n; // 100 %
const RATE_SCALE = 4; // percent with 4 decimals → ppm = percent × 10^4

class CommissionError extends Error {
  constructor(message, code = 'INVALID_COMMISSION') {
    super(message);
    this.name = 'CommissionError';
    this.code = code;
  }
}

/** "1.79" (percent) → 17900n ppm. */
function parseRatePercent(value, field = 'Komisyon oranı') {
  const ppm = parseDecimal(value, RATE_SCALE, { field, allowZero: true, max: MAX_RATE_PPM - 1n });
  if (ppm < 0n) throw new CommissionError(`${field} negatif olamaz`);
  return ppm;
}

/** 17900n → "1.7900" */
function formatRatePpm(ppm) {
  const v = BigInt(ppm);
  const whole = v / 10_000n;
  const frac = (v % 10_000n).toString().padStart(4, '0');
  return `${whole}.${frac}`;
}

/**
 * @param {bigint} grossMinor  positive kuruş
 * @param {{ ratePpm: bigint|number, fixedFeeMinor: bigint|number }} rule
 * @returns {{ commissionMinor: bigint, netMinor: bigint }}
 */
function computeCommission(grossMinor, { ratePpm, fixedFeeMinor = 0n }) {
  const gross = BigInt(grossMinor);
  if (gross <= 0n) throw new CommissionError('Brüt tutar pozitif olmalıdır');
  const rate = BigInt(ratePpm);
  const fee = BigInt(fixedFeeMinor);
  if (rate < 0n || rate >= MAX_RATE_PPM || fee < 0n) throw new CommissionError('Geçersiz komisyon kuralı');
  const commission = roundDiv(gross * rate, PPM, ROUNDING_MODE) + fee;
  if (commission > gross) {
    throw new CommissionError('Komisyon işlem tutarını aşıyor; tutar bu POS kuralıyla tahsil edilemez', 'COMMISSION_EXCEEDS_AMOUNT');
  }
  return { commissionMinor: commission, netMinor: gross - commission };
}

/**
 * Commission share of a partial refund: the cumulative proportion of the
 * original commission, so refunding the whole gross reverses it exactly.
 */
function refundCommissionShare(originalCommissionMinor, originalGrossMinor, alreadyRefundedGrossMinor, refundGrossMinor) {
  const k = BigInt(originalCommissionMinor);
  const g = BigInt(originalGrossMinor);
  const before = BigInt(alreadyRefundedGrossMinor);
  const afterGross = before + BigInt(refundGrossMinor);
  if (afterGross > g) throw new CommissionError('İade tutarı orijinal işlemi aşıyor', 'REFUND_EXCEEDS_PAYMENT');
  const cumulative = (part) => (part >= g ? k : roundDiv(k * part, g, ROUNDING_MODE));
  return cumulative(afterGross) - cumulative(before);
}

module.exports = {
  PPM, RATE_SCALE, CommissionError, parseRatePercent, formatRatePpm, computeCommission, refundCommissionShare,
};
