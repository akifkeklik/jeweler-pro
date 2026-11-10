const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

const finiteNumber = (v) => Number.isFinite(v);
const optionalSafeInt = (v) => v === null || v === undefined || Number.isSafeInteger(v);

/**
 * Cash / cari voucher (kasa fişi): the user-facing record of one cash or
 * account movement. The accounting effect lives in the linked immutable
 * LedgerEntry (journalEntryId); this document is never edited afterwards.
 *
 * Exact values: amountTryMinor (kuruş), amountGoldMg (mg fine gold).
 * amountTry / amountGoldGrams / balanceAfter* are the same values for display.
 */
const cashTransactionSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, trim: true, index: true, immutable: true },
    branch: { type: String, trim: true, default: '' },
    customerId: { type: Number, ref: 'Customer', index: true },
    supplierId: { type: Number, ref: 'Supplier', default: undefined },
    type: {
      type: String,
      enum: ['tahsilat', 'tediye', 'gider', 'devir', 'satis_tahsilati', 'hurda_alimi'],
      required: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['nakit', 'kredi kartı', 'havale', 'altın', 'cari'],
      default: 'nakit',
    },
    direction: { type: String, enum: ['borc', 'alacak', null], default: null },
    amountTry: { type: Number, default: 0, validate: finiteNumber },
    amountGoldGrams: { type: Number, default: 0, validate: finiteNumber },
    amountTryMinor: { type: Number, default: undefined, validate: optionalSafeInt },
    amountGoldMg: { type: Number, default: undefined, validate: optionalSafeInt },
    // Scrap purchase details
    weightMg: { type: Number, default: undefined, validate: optionalSafeInt },
    purity: { type: Number, default: undefined, validate: optionalSafeInt },
    fineMg: { type: Number, default: undefined, validate: optionalSafeInt },
    expenseCategory: { type: String, trim: true, default: undefined },
    saleId: { type: Number, ref: 'Sale' },
    description: { type: String, trim: true },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    balanceAfterTry: { type: Number, default: 0 },
    balanceAfterGold: { type: Number, default: 0 },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: undefined },
    date: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

cashTransactionSchema.index({ customerId: 1, date: -1 });
cashTransactionSchema.index({ date: -1, type: 1 });
cashTransactionSchema.index({ businessId: 1, branch: 1, date: -1 });

cashTransactionSchema.plugin(tenantGuard);

module.exports = mongoose.model('CashTransaction', cashTransactionSchema);
