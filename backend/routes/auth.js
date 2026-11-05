const express = require('express');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const User = require('../models/User');
const asyncHandler = require('../middleware/asyncHandler');
const loginRateLimit = require('../middleware/loginRateLimit');
const { signToken, authenticate } = require('../middleware/auth');

const router = express.Router();
const scrypt = promisify(crypto.scrypt);

async function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

router.post('/login', loginRateLimit, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password || email.length > 254 || password.length > 200) {
    return res.status(400).json({ error: 'E-posta ve şifre zorunludur' });
  }

  const user = await User.findOne({ email, active: true }).select('+passwordHash');
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
  }

  user.lastLoginAt = new Date();
  await user.save();
  const token = signToken(user);
  return res.json({
    token,
    expiresIn: 28800,
    user: { id: String(user._id), email: user.email, role: user.role },
  });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.auth.sub, active: true });
  if (!user) return res.status(401).json({ error: 'Kullanıcı hesabı etkin değil' });
  return res.json({ id: String(user._id), email: user.email, role: user.role });
}));

module.exports = router;
