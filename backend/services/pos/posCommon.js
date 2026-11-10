/** Helpers shared by the POS modules: money view, error mapping and safe input parsing. */
const mongoose = require('mongoose');
const { toDisplayNumber, DecimalError } = require('../../domain/decimal');
const { SCALE } = require('../../domain/precision');
const { CommissionError } = require('../../domain/commission');
const { badRequest, unprocessable } = require('../finance/core');

const DAY_MS = 24 * 60 * 60 * 1000;
/** Net amount of a card transaction not yet matched by a bank settlement. */
const openAmount = (t) => BigInt(t.netMinor) - BigInt(t.settledMinor || 0);

const money = (minor) => toDisplayNumber(BigInt(minor), SCALE.MONEY);

function wrap(error) {
  if (error instanceof DecimalError) return badRequest(error.message, error.code);
  if (error instanceof CommissionError) return unprocessable(error.message, error.code);
  return error;
}

function objectId(value, label) {
  if (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value) || String(new mongoose.Types.ObjectId(value)) !== value) {
    throw badRequest(`Geçerli bir ${label} seçilmelidir`, 'INVALID_ID');
  }
  return new mongoose.Types.ObjectId(value);
}

/** Card data must never be stored: reject anything that looks like a card number (PAN). */
function safeReferenceText(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} metin olmalıdır`);
  const text = value.trim().slice(0, 40);
  if (/\d{12,19}/.test(text.replace(/[\s-]/g, ''))) {
    throw badRequest(`${field} kart numarası içeremez; yalnızca terminal / provizyon kodunu girin`, 'CARD_DATA_REJECTED');
  }
  return text;
}

module.exports = { DAY_MS, money, openAmount, wrap, objectId, safeReferenceText };
