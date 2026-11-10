const nodemailer = require('nodemailer');
const { isStrictEnvironment } = require('../config/environment');
const { canonicalizeOrigin, getAllowedOrigins } = require('../config/origins');

/**
 * Transactional e-mail delivery over SMTP.
 * There is deliberately no "console"/"preview" fallback: when SMTP is missing
 * or unreachable the caller receives an explicit error, never a fake success.
 */

const VERIFY_CACHE_MS = 5 * 60 * 1000;

let cachedTransport = null;
let cachedTransportKey = '';
let lastVerifiedAt = 0;
let lastVerifiedKey = '';
const pendingDeliveries = new Set();

function smtpSettings() {
  return {
    host: String(process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '"Jeweler Pro ERP" <noreply@jewelerpro.local>',
    requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
  };
}

function getAppBaseUrl() {
  const explicit = String(process.env.APP_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  // Production (or an unsupported NODE_ENV) never falls back to CORS/localhost.
  if (isStrictEnvironment()) return '';
  return getAllowedOrigins()[0] || canonicalizeOrigin('http://localhost:8080');
}

/**
 * Configured means: SMTP host set, credentials either both present or both
 * absent (open relay inside a private network), and a public app URL known
 * (in production APP_URL is mandatory so links never point to localhost).
 */
function isEmailConfigured() {
  const s = smtpSettings();
  if (!s.host) return false;
  if (Boolean(s.user) !== Boolean(s.pass)) return false;
  if (!getAppBaseUrl()) return false;
  return true;
}

function configurationError() {
  const error = new Error('E-posta servisi yapılandırılmamış. Şifre sıfırlama e-postası gönderilemez; lütfen sistem yöneticinizle iletişime geçin.');
  error.statusCode = 503;
  error.code = 'SMTP_UNCONFIGURED';
  return error;
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  const s = smtpSettings();
  const key = JSON.stringify([s.host, s.port, s.secure, s.user, s.pass, s.requireTLS]);
  if (!cachedTransport || cachedTransportKey !== key) {
    cachedTransport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      requireTLS: s.requireTLS,
      ...(s.user ? { auth: { user: s.user, pass: s.pass } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    cachedTransportKey = key;
    lastVerifiedAt = 0;
  }
  return cachedTransport;
}

/**
 * Verifies that the SMTP server accepts connections (and credentials).
 * Successful checks are cached for a few minutes.
 */
async function ensureReady() {
  const transporter = getTransporter();
  if (!transporter) throw configurationError();
  if (lastVerifiedKey === cachedTransportKey && Date.now() - lastVerifiedAt < VERIFY_CACHE_MS) return true;
  try {
    await transporter.verify();
  } catch (cause) {
    const error = new Error('E-posta sunucusuna şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyin.');
    error.statusCode = 503;
    error.code = 'SMTP_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }
  lastVerifiedAt = Date.now();
  lastVerifiedKey = cachedTransportKey;
  return true;
}

function buildResetUrl(rawToken) {
  const url = new URL('/reset-password', `${getAppBaseUrl()}/`);
  url.searchParams.set('token', rawToken);
  return url.toString();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function sendPasswordResetEmail(email, rawToken, { expiresInMinutes = 60, name } = {}) {
  const transporter = getTransporter();
  if (!transporter) throw configurationError();

  const resetLink = buildResetUrl(rawToken);
  const textGreeting = name ? `Merhaba ${name},` : 'Merhaba,';
  const greeting = escapeHtml(textGreeting);
  return transporter.sendMail({
    from: smtpSettings().from,
    to: email,
    subject: 'Jeweler Pro — Şifre sıfırlama bağlantınız',
    text: [
      textGreeting,
      '',
      'Hesabınız için şifre sıfırlama talebinde bulunuldu.',
      `Yeni şifre belirlemek için bağlantıyı açın (${expiresInMinutes} dakika geçerli, tek kullanımlık):`,
      resetLink,
      '',
      'Bu talebi siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmeyecektir.',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #b8860b; margin-top: 0;">Jeweler Pro ERP</h2>
        <p>${greeting}</p>
        <p>Hesabınız için şifre sıfırlama talebinde bulunuldu. Bağlantı <strong>${expiresInMinutes} dakika</strong> geçerlidir ve yalnızca bir kez kullanılabilir.</p>
        <p style="margin: 28px 0; text-align: center;">
          <a href="${escapeHtml(resetLink)}" style="background: #b8860b; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Şifremi Sıfırla</a>
        </p>
        <p style="color: #64748b; font-size: 12px;">Düğme çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>${escapeHtml(resetLink)}</p>
        <p style="color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 12px;">Bu talebi siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmeyecektir.</p>
      </div>
    `,
  });
}

async function sendPasswordChangedNotice(email, { name } = {}) {
  const transporter = getTransporter();
  if (!transporter) throw configurationError();
  const greeting = name ? `Merhaba ${name},` : 'Merhaba,';
  return transporter.sendMail({
    from: smtpSettings().from,
    to: email,
    subject: 'Jeweler Pro — Şifreniz değiştirildi',
    text: `${greeting}\n\nJeweler Pro hesabınızın şifresi az önce değiştirildi ve tüm açık oturumlar kapatıldı.\nBu işlemi siz yapmadıysanız derhal sistem yöneticinizle iletişime geçin.`,
  });
}

/**
 * Runs a delivery in the background while keeping track of it so tests and
 * graceful shutdown can wait for completion.
 */
function dispatch(task) {
  const promise = Promise.resolve().then(task);
  const tracked = promise.catch(() => {}).finally(() => pendingDeliveries.delete(tracked));
  pendingDeliveries.add(tracked);
  return promise;
}

async function flushPendingDeliveries() {
  while (pendingDeliveries.size) {
    await Promise.all([...pendingDeliveries]);
  }
}

function resetCache() {
  cachedTransport = null;
  cachedTransportKey = '';
  lastVerifiedAt = 0;
  lastVerifiedKey = '';
}

module.exports = {
  isEmailConfigured,
  ensureReady,
  getTransporter,
  getAppBaseUrl,
  buildResetUrl,
  sendPasswordResetEmail,
  sendPasswordChangedNotice,
  dispatch,
  flushPendingDeliveries,
  resetCache,
};
