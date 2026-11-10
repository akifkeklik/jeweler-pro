/** API views of card captures/refunds and bank settlements. */
const { formatRatePpm } = require('../../domain/commission');
const { DAY_MS, money, openAmount } = require('./posCommon');

function transactionDto(t) {
  return {
    _id: t._id,
    branch: t.branch,
    providerId: t.providerId,
    providerCode: t.providerCode,
    kind: t.kind,
    source: t.source,
    reference: t.reference,
    installments: t.installments,
    commissionConfigured: Boolean(t.commissionSnapshot?.configured),
    ratePercent: t.commissionSnapshot?.configured ? formatRatePpm(t.commissionSnapshot.ratePpm) : null,
    fixedFee: t.commissionSnapshot?.configured ? money(t.commissionSnapshot.fixedFeeMinor || 0) : null,
    ruleVersion: t.commissionSnapshot?.ruleVersion ?? null,
    gross: money(t.grossMinor),
    commission: money(t.commissionMinor),
    net: money(t.netMinor),
    settled: money(t.settledMinor || 0),
    open: money(openAmount(t)),
    status: t.status,
    capturedAt: t.capturedAt,
    expectedSettlementDate: t.expectedSettlementDate,
    overdue: t.status !== 'settled' && t.expectedSettlementDate && new Date(t.expectedSettlementDate).getTime() < Date.now() - DAY_MS,
    terminalId: t.terminalId,
    authCode: t.authCode,
  };
}

function settlementDto(s) {
  return {
    _id: s._id,
    branch: s.branch,
    providerId: s.providerId,
    settlementDate: s.settlementDate,
    bankReference: s.bankReference,
    expected: money(s.expectedMinor),
    deposited: money(s.depositedMinor),
    difference: money(s.differenceMinor || 0),
    differenceResolution: s.differenceResolution,
    status: s.status,
    items: s.allocations.length,
    allocations: s.allocations.map((a) => ({ posTransactionId: a.posTransactionId, amount: money(a.amountMinor) })),
    reversedAt: s.reversedAt,
    reversalReason: s.reversalReason,
    notes: s.notes,
    createdAt: s.createdAt,
  };
}

/** Open receivable per provider and branch. */

module.exports = { transactionDto, settlementDto };
