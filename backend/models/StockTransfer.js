const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Inter-branch stock transfer (şubeler arası transfer).
 *
 * Lifecycle:
 *   draft ──approve──▶ approved ──dispatch──▶ in_transit ──receive──▶ partially_received ──▶ received
 *     │                  │
 *     ├─reject─▶ rejected└─cancel─▶ cancelled
 *     └─cancel─▶ cancelled
 *
 * - approve   reserves the goods at the source branch (they can no longer be sold)
 * - dispatch  issues them from the source at weighted-average cost into
 *             "goods in transit" (inventory_transit) — the transfer then
 *             cannot be cancelled any more
 * - receive   (partial or full) moves units from transit into the
 *             destination branch at exactly the dispatched cost
 * - resolve   closes a shortfall: returned to the source branch, or written
 *             off as a transfer loss (expense)
 *
 * Conservation invariant per line: dispatched = received + returned + writtenOff + outstanding,
 * for quantity, weight, fine content and cost. Stock is never created or
 * destroyed by a transition; every unit is in exactly one place.
 *
 * Money: kuruş integers. Weight / fine: mg. Purity: 1/10 000.
 */
const int = { type: Number, validate: Number.isSafeInteger };
const STATUSES = ['draft', 'approved', 'in_transit', 'partially_received', 'received', 'cancelled', 'rejected'];

const quantitiesSchema = new mongoose.Schema({
  quantity: { ...int, default: 0, min: 0 },
  weightMg: { ...int, default: 0, min: 0 },
  fineMg: { ...int, default: 0, min: 0 },
  // null = the cost of the dispatched goods is unknown (legacy stock)
  costMinor: { type: Number, default: 0, validate: (v) => v === null || Number.isSafeInteger(v) },
}, { _id: false });

const lineSchema = new mongoose.Schema({
  lineId: { type: Number, required: true },
  itemType: { type: String, required: true, enum: ['product', 'metal'] },
  // product lines
  productId: { type: Number, ref: 'Product', default: undefined },
  productName: { type: String, trim: true, default: undefined },
  destinationProductId: { type: Number, ref: 'Product', default: null },
  quantity: { ...int, default: 0, min: 0 },
  // metal lines (bulk metal pool of the given purity)
  metal: { type: String, enum: ['XAU', 'XAG'], default: undefined },
  purity: { ...int, default: undefined },
  weightMg: { ...int, default: 0, min: 0 },
  fineMg: { ...int, default: 0, min: 0 },
  // filled by the lifecycle
  dispatched: { type: quantitiesSchema, default: () => ({}) },
  received: { type: quantitiesSchema, default: () => ({}) },
  returned: { type: quantitiesSchema, default: () => ({}) },
  writtenOff: { type: quantitiesSchema, default: () => ({}) },
}, { _id: false });

const eventSchema = new mongoose.Schema({
  action: { type: String, required: true, trim: true },
  fromStatus: { type: String, enum: [...STATUSES, null], default: null },
  toStatus: { type: String, enum: STATUSES, required: true },
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  note: { type: String, trim: true, maxlength: 500, default: undefined },
  details: { type: mongoose.Schema.Types.Mixed, default: undefined },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: undefined },
}, { _id: false });

const stockTransferSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  sourceBranch: { type: String, required: true, trim: true, maxlength: 120, immutable: true },
  destinationBranch: { type: String, required: true, trim: true, maxlength: 120, immutable: true },
  status: { type: String, enum: STATUSES, default: 'draft', index: true },
  lines: { type: [lineSchema], required: true },
  notes: { type: String, trim: true, maxlength: 1000 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  dispatchedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  dispatchJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
  // Append-only history of every transition (who, when, what, which entry).
  events: { type: [eventSchema], default: [] },
}, { timestamps: true, _id: false, optimisticConcurrency: true });

stockTransferSchema.index({ businessId: 1, sourceBranch: 1, createdAt: -1 });
stockTransferSchema.index({ businessId: 1, destinationBranch: 1, createdAt: -1 });

stockTransferSchema.pre('validate', async function assignId() {
  if (!this.isNew || this._id != null) return;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = Math.floor(10000000 + Math.random() * 90000000);
    if (!(await mongoose.models.StockTransfer.exists({ _id: candidate }).setOptions({ skipTenantGuard: 'global-id-probe' }))) {
      this._id = candidate;
      return;
    }
  }
  throw new Error('Could not allocate a unique transfer ID after 10 attempts');
});

stockTransferSchema.plugin(tenantGuard);

module.exports = mongoose.model('StockTransfer', stockTransferSchema);
module.exports.STATUSES = STATUSES;
