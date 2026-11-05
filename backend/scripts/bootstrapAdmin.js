const crypto = require('node:crypto');
const { promisify } = require('node:util');
const User = require('../models/User');

const scrypt = promisify(crypto.scrypt);

async function bootstrapAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email && !password) {
    console.warn('ADMIN_EMAIL/ADMIN_PASSWORD tanımlı değil; ilk yönetici hesabı oluşturulmadı.');
    return;
  }
  if (!email || password.length < 14) {
    throw new Error('ADMIN_EMAIL ve en az 14 karakterli ADMIN_PASSWORD birlikte tanımlanmalıdır.');
  }

  const existing = await User.findOne({ email });
  if (existing) return;

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  await User.create({ email, passwordHash: salt + ':' + hash.toString('hex'), role: 'admin' });
  console.log('İlk yönetici hesabı oluşturuldu.');
}

module.exports = bootstrapAdmin;
