/**
 * POS providers (banks / virtual POS): commission rules per installment
 * count, settlement delay and the branches each provider serves.
 */
const PosProvider = require('../../models/PosProvider');
const AuditLog = require('../../models/AuditLog');
const { recordAudit } = require('../../utils/audit');
const { parseDecimal, toSafeInteger } = require('../../domain/decimal');
const { SCALE } = require('../../domain/precision');
const { parseRatePercent, formatRatePpm } = require('../../domain/commission');
const { assertBranch } = require('../finance/branchDirectory');
const { badRequest, notFound, conflict } = require('../finance/core');
const { money, wrap, objectId } = require('./posCommon');

function parseRules(raw) {
  if (!Array.isArray(raw) || !raw.length) throw badRequest('En az bir taksit/komisyon kuralı girilmelidir', 'POS_RULES_REQUIRED');
  if (raw.length > 36) throw badRequest('En fazla 36 kural tanımlanabilir');
  const seen = new Set();
  return raw.map((r) => {
    const installments = Number(r?.installments ?? 1);
    if (!Number.isSafeInteger(installments) || installments < 1 || installments > 36) throw badRequest('Taksit sayısı 1-36 arasında olmalıdır');
    if (seen.has(installments)) throw badRequest(`${installments} taksit için birden fazla kural var`, 'DUPLICATE_POS_RULE');
    seen.add(installments);
    const ratePpm = parseRatePercent(r?.ratePercent ?? '0');
    const fixedFeeMinor = parseDecimal(r?.fixedFee ?? '0', SCALE.MONEY, { field: 'Sabit işlem ücreti', max: 100000000n });
    const valorDays = Number(r?.valorDays ?? 1);
    if (!Number.isSafeInteger(valorDays) || valorDays < 0 || valorDays > 400) throw badRequest('Valör günü 0-400 arasında olmalıdır');
    return { installments, ratePpm: toSafeInteger(ratePpm), fixedFeeMinor: toSafeInteger(fixedFeeMinor), valorDays };
  }).sort((a, b) => a.installments - b.installments);
}

async function parseBranches(ctx, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest('branches bir dizi olmalıdır');
  const out = [];
  for (const b of raw) {
    out.push(await assertBranch(ctx.businessId, b));
  }
  return [...new Set(out)];
}

function providerDto(p) {
  const rule = (r) => ({
    installments: r.installments, ratePercent: formatRatePpm(r.ratePpm), fixedFee: money(r.fixedFeeMinor), valorDays: r.valorDays,
  });
  return {
    _id: p._id,
    code: p.code,
    name: p.name,
    branches: p.branches,
    active: p.active,
    refundCommissionPolicy: p.refundCommissionPolicy,
    version: p.version,
    validFrom: p.validFrom,
    rules: (p.rules || []).map(rule),
    history: (p.history || []).map((h) => ({
      version: h.version, validFrom: h.validFrom, validTo: h.validTo, refundCommissionPolicy: h.refundCommissionPolicy, rules: h.rules.map(rule),
    })),
  };
}

async function createProvider(ctx, body) {
  if (!body || typeof body !== 'object') throw badRequest('Geçerli bir POS tanımı gönderilmelidir');
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw badRequest('Kod 2-40 karakter, harf/rakam/-/_ olmalıdır', 'INVALID_CODE');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) throw badRequest('POS / banka adı girilmelidir');
  let rules;
  try {
    rules = parseRules(body.rules);
  } catch (error) {
    throw wrap(error);
  }
  const policy = body.refundCommissionPolicy || 'retained';
  if (!['retained', 'reversed'].includes(policy)) throw badRequest('İade komisyon politikası retained veya reversed olmalıdır');
  const branches = await parseBranches(ctx, body.branches);
  try {
    const provider = await PosProvider.create({
      businessId: ctx.businessId, code, name, branches, rules, refundCommissionPolicy: policy, createdBy: ctx.userId || null, validFrom: new Date(),
    });
    if (ctx.userId) {
      await recordAudit({
        AuditLog, actorUserId: ctx.userId, action: 'pos.provider_created', resourceType: 'PosProvider', resourceId: String(provider._id),
        correlationId: ctx.correlationId, after: { code, name, rules },
      });
    }
    return provider;
  } catch (error) {
    if (error?.code === 11000) throw conflict('Bu kodla bir POS sağlayıcısı zaten var', 'DUPLICATE');
    throw error;
  }
}

/** Changing rules or policy creates a new version; the old one moves to history. */
async function updateProvider(ctx, id, body) {
  const _id = objectId(id, 'POS sağlayıcısı');
  const provider = await PosProvider.findOne({ _id, businessId: ctx.businessId });
  if (!provider) throw notFound('POS sağlayıcısı bulunamadı', 'POS_PROVIDER_NOT_FOUND');
  const before = providerDto(provider);
  if (typeof body?.name === 'string' && body.name.trim()) provider.name = body.name.trim().slice(0, 120);
  if (typeof body?.active === 'boolean') provider.active = body.active;
  if (body?.branches !== undefined) provider.branches = await parseBranches(ctx, body.branches);
  const policy = body?.refundCommissionPolicy;
  if (policy !== undefined && !['retained', 'reversed'].includes(policy)) throw badRequest('İade komisyon politikası retained veya reversed olmalıdır');
  let rules = null;
  if (body?.rules !== undefined) {
    try {
      rules = parseRules(body.rules);
    } catch (error) {
      throw wrap(error);
    }
  }
  const rulesChanged = rules && JSON.stringify(rules) !== JSON.stringify(provider.rules.map((r) => ({
    installments: r.installments, ratePpm: r.ratePpm, fixedFeeMinor: r.fixedFeeMinor, valorDays: r.valorDays,
  })));
  const policyChanged = policy !== undefined && policy !== provider.refundCommissionPolicy;
  if (rulesChanged || policyChanged) {
    const now = new Date();
    provider.history.push({
      version: provider.version, rules: provider.rules, refundCommissionPolicy: provider.refundCommissionPolicy,
      validFrom: provider.validFrom || provider.createdAt, validTo: now, changedBy: ctx.userId || null,
    });
    if (rulesChanged) provider.rules = rules;
    if (policyChanged) provider.refundCommissionPolicy = policy;
    provider.version += 1;
    provider.validFrom = now;
  }
  await provider.save();
  if (ctx.userId) {
    await recordAudit({
      AuditLog, actorUserId: ctx.userId, action: 'pos.provider_updated', resourceType: 'PosProvider', resourceId: String(provider._id),
      correlationId: ctx.correlationId, before, after: providerDto(provider),
    });
  }
  return provider;
}

module.exports = { createProvider, updateProvider, providerDto, parseRules };
