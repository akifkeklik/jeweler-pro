/**
 * Business profile: legal identity for receipts plus fiscal (KDV) and
 * compliance (MASAK/KVKK) settings, one document per business.
 */
const { z } = require('zod');
const BusinessProfile = require('../models/BusinessProfile');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../utils/audit');
const { isValidTaxNumber } = require('../utils/identity');
const { parseDecimal, toSafeInteger } = require('../domain/decimal');
const { SCALE } = require('../domain/precision');
const { DEFAULT_STANDARD_RATE_BP } = require('../domain/vat');

const text = (max) => z.string().trim().max(max);

const updateSchema = z.object({
  companyName: text(200).optional(),
  authorizedPerson: text(120).optional(),
  taxOffice: text(120).optional(),
  taxNumber: text(11)
    .refine((v) => v === '' || isValidTaxNumber(v), 'Vergi numarası 10 haneli VKN veya geçerli 11 haneli TCKN olmalıdır')
    .optional(),
  mersisNo: text(16).refine((v) => v === '' || /^\d{16}$/.test(v), 'MERSİS numarası 16 haneli olmalıdır').optional(),
  phone: text(40).optional(),
  email: z.union([z.literal(''), z.email('Geçerli bir e-posta adresi girin').max(254)]).optional(),
  address: text(500).optional(),
  receiptFooter: text(500).optional(),
  vat: z.object({
    enabled: z.boolean().optional(),
    standardRateBp: z.number().int().min(0).max(10000).optional(),
    approvedBy: text(120).optional(),
  }).strict().optional(),
  compliance: z.object({
    // Decimal TL string ("185000.00") or null to switch the check off.
    identificationThreshold: z.union([
      z.null(),
      z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Eşik tutarı ondalık TL olarak girilmelidir'),
    ]).optional(),
    kvkkNoticeVersion: text(40).optional(),
  }).strict().optional(),
}).strict();

const IDENTITY_FIELDS = ['companyName', 'authorizedPerson', 'taxOffice', 'taxNumber', 'mersisNo', 'phone', 'email', 'address', 'receiptFooter'];

function defaults(businessId) {
  return {
    businessId,
    ...Object.fromEntries(IDENTITY_FIELDS.map((key) => [key, ''])),
    vat: { enabled: false, standardRateBp: DEFAULT_STANDARD_RATE_BP, approvedBy: '', approvedAt: null },
    compliance: { identificationThresholdMinor: null, kvkkNoticeVersion: '' },
  };
}

function toDto(doc) {
  const p = doc || {};
  const threshold = p.compliance?.identificationThresholdMinor;
  return {
    ...Object.fromEntries(IDENTITY_FIELDS.map((key) => [key, p[key] || ''])),
    vat: {
      enabled: Boolean(p.vat?.enabled),
      standardRateBp: p.vat?.standardRateBp ?? DEFAULT_STANDARD_RATE_BP,
      approvedBy: p.vat?.approvedBy || '',
      approvedAt: p.vat?.approvedAt || null,
    },
    compliance: {
      identificationThreshold: threshold === null || threshold === undefined ? null : threshold / 100,
      kvkkNoticeVersion: p.compliance?.kvkkNoticeVersion || '',
    },
    updatedAt: p.updatedAt || null,
    configured: Boolean(p.companyName && p.taxNumber),
  };
}

/** Raw profile document (defaults when the business has none yet). */
async function loadProfile(businessId, { session } = {}) {
  const query = BusinessProfile.findOne({ businessId }).lean();
  if (session) query.session(session);
  return (await query) || defaults(businessId);
}

async function getProfile(ctx) {
  return toDto(await loadProfile(ctx.businessId));
}

function domainError(status, message, code) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  return error;
}

async function updateProfile(ctx, input) {
  const before = await loadProfile(ctx.businessId);
  const base = defaults(ctx.businessId);
  const next = {};
  for (const key of IDENTITY_FIELDS) next[key] = input[key] !== undefined ? input[key] : (before[key] ?? base[key]);

  next.vat = { ...base.vat, ...before.vat };
  if (input.vat) {
    if (input.vat.standardRateBp !== undefined) next.vat.standardRateBp = input.vat.standardRateBp;
    if (input.vat.approvedBy !== undefined) next.vat.approvedBy = input.vat.approvedBy;
    if (input.vat.enabled !== undefined) {
      // Guardrail: VAT posting changes the books, so it can only be switched
      // on together with the name of the accountant who confirmed the rules.
      if (input.vat.enabled && !next.vat.approvedBy) {
        throw domainError(422, 'KDV hesaplamasını açmadan önce kuralları onaylayan mali müşavirin adını girin', 'VAT_APPROVAL_REQUIRED');
      }
      if (input.vat.enabled && !before.vat?.enabled) next.vat.approvedAt = new Date();
      next.vat.enabled = input.vat.enabled;
    }
  }

  next.compliance = { ...base.compliance, ...before.compliance };
  if (input.compliance) {
    const { identificationThreshold, kvkkNoticeVersion } = input.compliance;
    if (identificationThreshold !== undefined) {
      next.compliance.identificationThresholdMinor = identificationThreshold === null
        ? null
        : toSafeInteger(parseDecimal(identificationThreshold, SCALE.MONEY, { field: 'Kimlik tespit eşiği' }));
    }
    if (kvkkNoticeVersion !== undefined) next.compliance.kvkkNoticeVersion = kvkkNoticeVersion;
  }

  const saved = await BusinessProfile.findOneAndUpdate(
    { businessId: ctx.businessId },
    { $set: { ...next, updatedBy: ctx.userId || null }, $setOnInsert: { _id: ctx.businessId } },
    { upsert: true, new: true, runValidators: true, lean: true },
  );
  await recordAudit({
    AuditLog,
    actorUserId: ctx.userId,
    action: 'business_profile.updated',
    resourceType: 'BusinessProfile',
    resourceId: ctx.businessId,
    correlationId: ctx.correlationId,
    before: toDto(before),
    after: toDto(saved),
  });
  return toDto(saved);
}

module.exports = { updateSchema, getProfile, updateProfile, loadProfile, toDto };
