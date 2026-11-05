const crypto = require('node:crypto');
const { promisify } = require('node:util');
const User = require('../models/User');

const scrypt = promisify(crypto.scrypt);

async function bootstrapAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email && !password) {
    const existingAdmin = await User.exists({ role: 'admin', active: true });
    if (existingAdmin) return;
    throw new Error('İlk yönetici için ADMIN_EMAIL ve ADMIN_PASSWORD tanımlanmalıdır.');
  }
  if (!email || password.length < 14) {
    throw new Error('ADMIN_EMAIL ve en az 14 karakterli ADMIN_PASSWORD birlikte tanımlanmalıdır.');
  }

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'admin') throw new Error('ADMIN_EMAIL mevcut bir yönetici olmayan kullanıcıya ait.');
    return;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  await User.create({ email, passwordHash: salt + ':' + hash.toString('hex'), role: 'admin' });
  console.log('İlk yönetici hesabı oluşturuldu.');
}

module.exports = bootstrapAdmin;
