const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { getAuthConfig } = require('../config/authConfig');

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(String(password), salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash)) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length === 0) return false;
  const actual = await scrypt(String(password), salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// A fixed, valid hash used to spend the same scrypt time when the account does
// not exist, so login response time does not reveal registered e-mails.
let dummyHashPromise;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(24).toString('hex'));
  return dummyHashPromise;
}

async function burnPasswordCheck(password) {
  await verifyPassword(password, await getDummyHash());
  return false;
}

/**
 * Returns a Turkish error message, or null when the password is acceptable.
 */
function validatePasswordPolicy(password, { email } = {}) {
  const { passwordMinLength, passwordMaxLength } = getAuthConfig();
  const value = typeof password === 'string' ? password : '';
  if (value.length < passwordMinLength) {
    return `Şifre en az ${passwordMinLength} karakter olmalıdır`;
  }
  if (value.length > passwordMaxLength) {
    return `Şifre en fazla ${passwordMaxLength} karakter olabilir`;
  }
  if (/^(.)\1+$/.test(value)) {
    return 'Şifre tek bir karakterin tekrarından oluşamaz';
  }
  if (email && value.toLowerCase() === String(email).toLowerCase()) {
    return 'Şifre e-posta adresinizle aynı olamaz';
  }
  return null;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function isOpaqueToken(value, bytes = 32) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value);
}

module.exports = {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  validatePasswordPolicy,
  sha256Hex,
  generateOpaqueToken,
  isOpaqueToken,
};
