const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission, validateNumericId, hasPermission } = require('../middleware/authorization');
const { getAll, getById, create, update, deleteItem } = require('../utils/crudOperations');
const Customer = require('../models/Customer');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../utils/audit');
const { maskNationalId, isValidIdentityNumber, IDENTITY_TYPES } = require('../utils/identity');
const { tenantContext, forbidden, conflict, badRequest } = require('../services/finance/core');

// Every query is limited to the caller's business (tenant isolation);
// another tenant's id behaves exactly like a missing one.
const scope = (req) => ({ businessId: tenantContext(req).businessId });

// Server-maintained fields: never written by the client.
const SERVER_FIELDS = ['identityVerifiedAt', 'kvkkNoticeAt', 'anonymizedAt'];

/**
 * KVKK data minimisation: the identity number is only shown in full to users
 * who may edit customers; lists always show it masked.
 */
function customerDto(doc, { revealIdentity = false } = {}) {
  const c = doc?.toObject ? doc.toObject() : { ...doc };
  if (c.identityNumber && !revealIdentity) c.identityNumber = maskNationalId(c.identityNumber);
  return c;
}

/**
 * The credit limit is the control on sales on account (BUSINESS_RULES.md
 * §12): changing it needs accounts:manage. Echoing the stored value back
 * (the UI sends the whole record on edit) is not a change.
 */
function assertCreditLimitChange(req, current = 0) {
  if (!req.body || typeof req.body !== 'object' || !('creditLimit' in req.body)) return;
  if (hasPermission(req.user, 'accounts:manage')) return;
  const requested = Number(req.body.creditLimit);
  if (Number.isFinite(requested) && requested === Number(current || 0)) return;
  throw forbidden('Kredi limitini değiştirme yetkiniz bulunmuyor', 'FORBIDDEN');
}

/** Normalises identity / KVKK input and stamps the server-side timestamps. */
function withServerFields(body, current = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const data = { ...body };
  for (const key of SERVER_FIELDS) delete data[key];
  if (typeof data.identityNumber === 'string') {
    data.identityNumber = data.identityNumber.replace(/\s+/g, '').toUpperCase() || null;
    if (data.identityNumber) {
      // Validated here, not only in the schema: update validators run in query
      // context and cannot see the stored identityType.
      const type = data.identityType !== undefined ? data.identityType : current.identityType;
      if (!IDENTITY_TYPES.includes(type)) throw badRequest('Kimlik belgesi türü seçilmelidir (TCKN, pasaport, yabancı kimlik)', 'IDENTITY_TYPE_REQUIRED');
      if (!isValidIdentityNumber(type, data.identityNumber)) throw badRequest('Kimlik numarası geçersiz', 'INVALID_IDENTITY_NUMBER');
      if (data.identityNumber !== current.identityNumber) data.identityVerifiedAt = new Date();
    } else {
      data.identityType = null;
      data.identityVerifiedAt = null;
    }
  }
  if (typeof data.kvkkNoticeVersion === 'string' && data.kvkkNoticeVersion.trim()
    && data.kvkkNoticeVersion.trim() !== current.kvkkNoticeVersion) {
    data.kvkkNoticeAt = new Date();
  }
  return data;
}

router.get('/', requirePermission('customers:read'), asyncHandler(async (req, res) => {
  const customers = await getAll(Customer, scope(req));
  res.json(customers.map((c) => customerDto(c)));
}));

router.get('/:id', validateNumericId, requirePermission('customers:read'), asyncHandler(async (req, res) => {
  const customer = await getById(Customer, req.params.id, scope(req));
  res.json(customerDto(customer, { revealIdentity: hasPermission(req.user, 'customers:write') }));
}));

router.post('/', requirePermission('customers:write'), asyncHandler(async (req, res) => {
  assertCreditLimitChange(req, 0);
  const created = await create(Customer, withServerFields(req.body), scope(req));
  res.status(201).json(customerDto(created, { revealIdentity: true }));
}));

router.put('/:id', validateNumericId, requirePermission('customers:write'), asyncHandler(async (req, res) => {
  const current = await getById(Customer, req.params.id, scope(req));
  if (current.anonymizedAt) throw conflict('Anonimleştirilmiş müşteri düzenlenemez', 'CUSTOMER_ANONYMIZED');
  if (req.body && typeof req.body === 'object' && 'creditLimit' in req.body && !hasPermission(req.user, 'accounts:manage')) {
    assertCreditLimitChange(req, current.creditLimit);
  }
  const updated = await update(Customer, req.params.id, withServerFields(req.body, current), scope(req));
  res.json(customerDto(updated, { revealIdentity: true }));
}));

function assertNoOpenBalance(current, action) {
  if ((current.balanceTryMinor || 0) !== 0 || (current.balanceGoldMg || 0) !== 0) {
    throw conflict(`Açık bakiyesi olan müşteri ${action}; önce bakiyeyi kapatın`, 'OPEN_BALANCE', {
      balanceTry: (current.balanceTryMinor || 0) / 100, balanceGold: (current.balanceGoldMg || 0) / 1000,
    });
  }
}

router.delete('/:id', validateNumericId, requirePermission('customers:delete'), asyncHandler(async (req, res) => {
  // An open receivable / credit (TRY or gold) must be settled first: an
  // archived customer disappears from every list while the balance remains.
  const current = await getById(Customer, req.params.id, scope(req));
  assertNoOpenBalance(current, 'arşivlenemez');
  // Conditional archive: a posting racing this request cannot be orphaned.
  const customer = await deleteItem(Customer, req.params.id, { ...scope(req), balanceTryMinor: { $in: [0, null] }, balanceGoldMg: { $in: [0, null] } });
  res.json({ message: 'Müşteri arşivlendi; satış geçmişi korundu', data: customerDto(customer) });
}));

/**
 * KVKK erasure request (unutulma hakkı): the person's identifying data is
 * removed; the numeric customer id, balances and sales stay so the books
 * remain intact. Invoices already issued are retained by the e-Arşiv
 * provider under tax law; that retention is outside this application.
 */
router.post('/:id/anonymize', validateNumericId, requirePermission('customers:delete'), asyncHandler(async (req, res) => {
  const ctx = tenantContext(req);
  const current = await getById(Customer, req.params.id, scope(req));
  if (current.anonymizedAt) throw conflict('Müşteri zaten anonimleştirilmiş', 'CUSTOMER_ANONYMIZED');
  assertNoOpenBalance(current, 'anonimleştirilemez');
  const updated = await Customer.findOneAndUpdate(
    { _id: current._id, businessId: ctx.businessId, anonymizedAt: null, balanceTryMinor: { $in: [0, null] }, balanceGoldMg: { $in: [0, null] } },
    {
      $set: {
        name: `Anonim Müşteri #${current._id}`,
        phone: null,
        email: null,
        address: null,
        taxNumber: null,
        taxOffice: null,
        notes: null,
        identityType: null,
        identityNumber: null,
        identityVerifiedAt: null,
        marketingConsent: false,
        anonymizedAt: new Date(),
        isArchived: true,
      },
    },
    { new: true },
  );
  if (!updated) throw conflict('Müşteri bu sırada değişti; lütfen tekrar deneyin', 'CUSTOMER_CHANGED');
  await recordAudit({
    AuditLog,
    actorUserId: ctx.userId,
    action: 'customer.anonymized',
    resourceType: 'Customer',
    resourceId: current._id,
    correlationId: ctx.correlationId,
  });
  res.json({ message: 'Müşterinin kişisel verileri silindi; finansal kayıtlar korundu', data: customerDto(updated) });
}));

module.exports = router;
