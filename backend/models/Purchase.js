const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Purchase from a supplier (alış faturası): increases stock (products or
 * metal pools), creates the supplier payable and records payments.
 * Monetary fields are kuruş integers; weights mg; purity 1/10 000.
 * Lines, totals and the posted journal entries are immutable; payments and
 * cancellation append new journal entries.
 */
const int = { type: Number, validate: Number.isSafeInteger };

const purchaseLineSchema = new mongoose.Schema({
  lineId: { type: Number, required: true },
  itemType: { type: String, required: true, enum: ['product', 'metal'] },
  productId: { type: Number, ref: 'Product', default: undefined },
  productName: { type: String, trim: true, default: undefined },
  quantity: { ...int, default: 0, min: 0 },
  metal: { type: String, enum: ['XAU', 'XAG'], default: undefined },
  purity: { ...int, default: undefined },
  weightMg: { ...int, default: 0, min: 0 },
  fineMg: { ...int, default: 0, min: 0 },
  unitCostMinor: { ...int, default: 0, min: 0 },
  totalMinor: { ...int, required: true, min: 0 },
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  // refund = money the supplier paid back to us (after a return)
  kind: { type: String, enum: ['payment', 'refund'], default: 'payment' },
  method: { type: String, required: true, enum: ['nakit', 'kredi kartı', 'havale'] },
  amountMinor: { ...int, required: true },
  at: { type: Date, default: Date.now },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

/** Running returned figures per purchase line (the lines themselves are immutable). */
const lineReturnSchema = new mongoose.Schema({
  lineId: { type: Number, required: true },
  quantity: { ...int, default: 0, min: 0 },
  weightMg: { ...int, default: 0, min: 0 },
  fineMg: { ...int, default: 0, min: 0 },
  // supplier credit for returned goods / for price adjustments, kuruş
  amountMinor: { ...int, default: 0, min: 0 },
  adjustedMinor: { ...int, default: 0, min: 0 },
}, { _id: false });

/**
 * One purchase return (iade alış faturası) or supplier price adjustment
 * (fiyat farkı / alacak dekontu). Append-only: a return is never edited.
 */
const purchaseReturnSchema = new mongoose.Schema({
  returnId: { type: Number, required: true },
  kind: { type: String, enum: ['goods', 'price_adjustment'], required: true },
  lines: [{
    _id: false,
    lineId: { type: Number, required: true },
    quantity: { ...int, default: 0, min: 0 },
    weightMg: { ...int, default: 0, min: 0 },
    fineMg: { ...int, default: 0, min: 0 },
    amountMinor: { ...int, required: true, min: 0 },
    // inventory cost removed at weighted average (goods only)
    costMinor: { type: Number, default: null, validate: (v) => v === null || Number.isSafeInteger(v) },
  }],
  amountMinor: { ...int, required: true, min: 0 },
  costMinor: { ...int, default: 0, min: 0 },
  varianceMinor: { ...int, default: 0 },
  refundMinor: { ...int, default: 0, min: 0 },
  reason: { type: String, trim: true, maxlength: 300, required: true },
  creditNoteNo: { type: String, trim: true, maxlength: 60, default: undefined },
  at: { type: Date, default: Date.now },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const purchaseSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  branch: { type: String, required: true, trim: true, immutable: true },
  supplierId: { type: Number, ref: 'Supplier', required: true, immutable: true },
  invoiceNo: { type: String, trim: true, maxlength: 60, default: undefined },
  lines: { type: [purchaseLineSchema], required: true, immutable: true },
  totalMinor: { ...int, required: true, min: 0, immutable: true },
  paidMinor: { ...int, default: 0, min: 0 },
  payments: { type: [paymentSchema], default: [] },
  // overpaid = after returns the supplier owes us money (supplier credit)
  paymentStatus: { type: String, enum: ['paid', 'partial', 'unpaid', 'overpaid'], default: 'unpaid' },
  returnedMinor: { ...int, default: 0, min: 0 },
  refundedMinor: { ...int, default: 0, min: 0 },
  returnStatus: { type: String, enum: ['none', 'partial', 'full'], default: 'none' },
  lineReturns: { type: [lineReturnSchema], default: [] },
  returns: { type: [purchaseReturnSchema], default: [] },
  status: { type: String, enum: ['completed', 'cancelled'], default: 'completed', index: true },
  date: { type: Date, required: true, default: Date.now, index: true },
  notes: { type: String, trim: true, maxlength: 1000 },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry' },
  cancelJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
  cancelledAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, _id: false });

purchaseSchema.index({ businessId: 1, supplierId: 1, date: -1 });

purchaseSchema.pre('validate', async function assignId() {
  if (!this.isNew || this._id != null) return;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = Math.floor(10000000 + Math.random() * 90000000);
    if (!(await mongoose.models.Purchase.exists({ _id: candidate }).setOptions({ skipTenantGuard: 'global-id-probe' }))) {
      this._id = candidate;
      return;
    }
  }
  throw new Error('Could not allocate a unique purchase ID after 10 attempts');
});

purchaseSchema.plugin(tenantGuard);

module.exports = mongoose.model('Purchase', purchaseSchema);
