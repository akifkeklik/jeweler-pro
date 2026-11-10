function toCents(value, fieldName = 'Tutar') {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`${fieldName} geçerli bir sayı olmalıdır`);
  }

  const text = String(value).trim();
  const match = text.match(/^(\+?)(\d+)(?:\.(\d+))?$/);
  if (!match || !Number.isFinite(Number(value))) {
    throw new Error(`${fieldName} geçerli bir sayı olmalıdır`);
  }

  const fraction = match[3] || '';
  const wholeCents = BigInt(match[2]) * 100n;
  const firstTwo = fraction.slice(0, 2).padEnd(2, '0');
  let cents = wholeCents + BigInt(firstTwo);
  if (fraction[2] && fraction[2] >= '5') cents += 1n;

  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${fieldName} güvenli sayı sınırını aşıyor`);
  }
  return Number(cents);
}

function fromCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Kuruş değeri güvenli sayı sınırını aşıyor');
  }
  return cents / 100;
}

function multiplyMoney(value, quantity, fieldName = 'Tutar') {
  const cents = toCents(value, fieldName);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error('Miktar pozitif bir tam sayı olmalıdır');
  }
  const total = BigInt(cents) * BigInt(quantity);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${fieldName} güvenli sayı sınırını aşıyor`);
  }
  return fromCents(Number(total));
}

module.exports = { toCents, fromCents, multiplyMoney };
