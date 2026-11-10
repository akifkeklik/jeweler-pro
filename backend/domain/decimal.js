/**
 * Exact fixed-point decimal arithmetic on BigInt.
 *
 * Every financial value is represented as a BigInt "scaled integer":
 * 123.45 TRY at scale 2 is 12345n, 2.500 g at scale 3 is 2500n. Arithmetic is
 * exact; rounding happens only where a function is explicitly asked to change
 * scale, using an explicit rounding mode. JavaScript floating point is never
 * used for intermediate financial results.
 *
 * Inputs are parsed strictly: plain decimal notation only ("1234.56",
 * "-0.5"); no exponent notation, thousands separators, decimal commas,
 * Infinity or NaN. A number input is converted through its shortest
 * round-trip string (0.1 → "0.1"), so a value typed as 0.1 is 0.1 exactly.
 */
const ROUNDING = Object.freeze({
  /** 0.5 rounds away from zero (commercial rounding). Default policy. */
  HALF_UP: 'HALF_UP',
  /** 0.5 rounds to the even neighbour (banker's rounding). */
  HALF_EVEN: 'HALF_EVEN',
  /** Truncate toward zero. */
  DOWN: 'DOWN',
});

class DecimalError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'DecimalError';
    this.statusCode = 400;
    this.code = 'INVALID_DECIMAL';
    this.field = field;
  }
}

const TEN = 10n;
const pow10 = (n) => TEN ** BigInt(n);
const abs = (v) => (v < 0n ? -v : v);

/**
 * Divides two BigInts and rounds the quotient.
 */
function roundDiv(numerator, denominator, mode = ROUNDING.HALF_UP) {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
    throw new TypeError('roundDiv expects BigInt operands');
  }
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = abs(numerator);
  const d = abs(denominator);
  let q = n / d;
  const r = n % d;
  if (r !== 0n) {
    const twice = r * 2n;
    if (mode === ROUNDING.HALF_UP) {
      if (twice >= d) q += 1n;
    } else if (mode === ROUNDING.HALF_EVEN) {
      if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
    } else if (mode !== ROUNDING.DOWN) {
      throw new RangeError(`Unknown rounding mode: ${mode}`);
    }
  }
  return negative ? -q : q;
}

const PLAIN_DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a user/API value into a scaled BigInt.
 *
 * options:
 *   field        name used in error messages
 *   allowNegative (default false)
 *   allowZero     (default true)
 *   round         when true, excess fraction digits are rounded (HALF_UP)
 *                 instead of rejected — only for trusted machine inputs such
 *                 as market quotes, never for amounts typed by a user
 *   min / max     bounds as scaled BigInt (inclusive)
 */
function parseDecimal(value, scale, {
  field = 'Değer',
  allowNegative = false,
  allowZero = true,
  round = false,
  min,
  max,
} = {}) {
  let text;
  if (typeof value === 'bigint') {
    throw new DecimalError(`${field} ölçekli tam sayı olarak değil, ondalık olarak gönderilmelidir`, field);
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DecimalError(`${field} geçerli bir sayı olmalıdır`, field);
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    throw new DecimalError(`${field} geçerli bir sayı olmalıdır`, field);
  }
  const match = text.match(PLAIN_DECIMAL);
  if (!match) {
    throw new DecimalError(`${field} geçerli bir ondalık sayı olmalıdır (örn. 1234.56)`, field);
  }
  const [, sign, whole, fraction = ''] = match;
  if (whole.length + fraction.length > 30) throw new DecimalError(`${field} çok büyük`, field);

  let scaled;
  if (fraction.length <= scale) {
    scaled = BigInt(whole + fraction.padEnd(scale, '0'));
  } else if (round) {
    scaled = roundDiv(BigInt(whole + fraction), pow10(fraction.length - scale), ROUNDING.HALF_UP);
  } else {
    throw new DecimalError(`${field} en fazla ${scale} ondalık basamak içerebilir`, field);
  }
  if (sign === '-') scaled = -scaled;

  if (scaled < 0n && !allowNegative) throw new DecimalError(`${field} negatif olamaz`, field);
  if (scaled === 0n && !allowZero) throw new DecimalError(`${field} sıfırdan büyük olmalıdır`, field);
  if (min !== undefined && scaled < min) throw new DecimalError(`${field} izin verilen alt sınırın altında`, field);
  if (max !== undefined && scaled > max) throw new DecimalError(`${field} izin verilen üst sınırı aşıyor`, field);
  if (abs(scaled) > BigInt(Number.MAX_SAFE_INTEGER)) throw new DecimalError(`${field} güvenli sayı sınırını aşıyor`, field);
  return scaled;
}

/** Changes the scale of a scaled integer, rounding when precision is dropped. */
function rescale(value, fromScale, toScale, mode = ROUNDING.HALF_UP) {
  if (toScale >= fromScale) return value * pow10(toScale - fromScale);
  return roundDiv(value, pow10(fromScale - toScale), mode);
}

/**
 * Multiplies scaled integers and returns the result at `resultScale`,
 * rounding exactly once.
 */
function multiply(a, aScale, b, bScale, resultScale, mode = ROUNDING.HALF_UP) {
  return rescale(a * b, aScale + bScale, resultScale, mode);
}

/** Exact decimal text of a scaled integer ("-12.30"). */
function format(value, scale) {
  if (typeof value !== 'bigint') value = BigInt(value);
  const negative = value < 0n;
  const digits = abs(value).toString().padStart(scale + 1, '0');
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? `.${digits.slice(-scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Scaled BigInt → JS integer for storage. Throws outside the safe range. */
function toSafeInteger(value, field = 'Değer') {
  if (typeof value !== 'bigint') throw new TypeError('toSafeInteger expects a BigInt');
  if (abs(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DecimalError(`${field} güvenli sayı sınırını aşıyor`, field);
  }
  return Number(value);
}

/** Stored integer → BigInt, validating it really is a safe integer. */
function fromSafeInteger(value, field = 'Değer') {
  if (!Number.isSafeInteger(value)) {
    throw new DecimalError(`${field} kayıtlı değeri bozuk (tam sayı değil)`, field);
  }
  return BigInt(value);
}

/**
 * Presentation helper: scaled integer → JS number for JSON responses.
 * The value is produced from the exact decimal text, so 12345 (scale 2)
 * becomes exactly the double nearest to 123.45. Never feed the result back
 * into calculations.
 */
function toDisplayNumber(value, scale) {
  return Number(format(typeof value === 'bigint' ? value : BigInt(value), scale));
}

const sum = (values) => values.reduce((total, v) => total + v, 0n);
const min = (a, b) => (a < b ? a : b);
const max = (a, b) => (a > b ? a : b);

module.exports = {
  ROUNDING,
  DecimalError,
  pow10,
  roundDiv,
  parseDecimal,
  rescale,
  multiply,
  format,
  toSafeInteger,
  fromSafeInteger,
  toDisplayNumber,
  sum,
  min,
  max,
};
