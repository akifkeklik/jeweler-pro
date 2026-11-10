const test = require('node:test');
const assert = require('node:assert/strict');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../utils/audit');

test('audit records require server context and never accept sensitive fields', async () => {
  const entries = [];
  const AuditLogStub = {
    create: async ([entry]) => {
      entries.push(entry);
      return [entry];
    },
  };

  await recordAudit({
    AuditLog: AuditLogStub,
    actorUserId: '507f1f77bcf86cd799439011',
    action: 'sale.created',
    resourceType: 'Sale',
    resourceId: 123,
    correlationId: 'corr-1',
    after: { totalPrice: 100, passwordHash: 'never-store', nested: { token: 'never-store' } },
  });

  assert.equal(entries[0].resourceId, '123');
  assert.equal(entries[0].correlationId, 'corr-1');
  assert.equal(entries[0].password, undefined);
  assert.equal(entries[0].token, undefined);
  assert.equal(entries[0].after.passwordHash, undefined);
  assert.equal(entries[0].after.nested.token, undefined);
});

test('audit records are immutable by schema and update fields are not exposed', () => {
  assert.equal(AuditLog.schema.path('action').options.immutable, true);
  assert.equal(AuditLog.schema.path('actorUserId').options.immutable, true);
  assert.equal(AuditLog.schema.path('createdAt').options.immutable, true);
  assert.equal(AuditLog.schema.path('password'), undefined);
});

test('audit context is mandatory', async () => {
  await assert.rejects(
    recordAudit({
      AuditLog: { create: async () => [] },
      actorUserId: null,
      action: 'auth.login',
      resourceType: 'User',
      resourceId: '1',
      correlationId: null,
    }),
    /Audit context eksik/,
  );
});
