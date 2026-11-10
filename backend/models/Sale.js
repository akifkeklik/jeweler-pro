const mongoose = require("mongoose");
const tenantGuard = require("./plugins/tenantGuard");

const finiteNonNegative = (value) => Number.isFinite(value) && value >= 0;
const safeInt = { type: Number, validate: Number.isSafeInteger };

/**
 * Sale (satış fişi).
 *
 * New sales carry immutable `lines` with a full pricing snapshot (market
 * quote, purity, weight, labor, discount, unit cost) so a sale can always be
 * re-explained exactly, regardless of later price or catalogue changes.
 * Money: kuruş integers (…Minor). Weights: mg. Purity: 1/10 000.
 *
 * Legacy single-product fields (productId, quantity, totalPrice,
 * unitPriceAtSale, unitCostAtSale, paymentMethod) are still populated for
 * every sale — productId/quantity/unitPrice describe the FIRST line, the
 * totals describe the whole sale — so existing reports and clients keep
 * working. Multi-line aware code must use `lines`.
 */
const priceSnapshotSchema = new mongoose.Schema({
  priceType: { type: String, enum: ["live", "manual"], required: true },
  symbol: { type: String, trim: true },
  source: { type: String, trim: true },
  side: { type: String, enum: ["buy", "sell"] },
  pricePerGram: { type: String, required: true }, // exact decimal text, scale 4
  quotedBuy: { type: String },
  quotedSell: { type: String },
  sourceTimestamp: { type: Date },
  receivedAt: { type: Date },
}, { _id: false });

const saleLineSchema = new mongoose.Schema({
  lineId: { type: Number, required: true },
  productId: { type: Number, ref: "Product", required: true },
  productName: { type: String, trim: true },
  pricingMode: { type: String, enum: ["fixed", "gram"], required: true },
  quantity: { ...safeInt, required: true, min: 1 },
  metal: { type: String, enum: ["XAU", "XAG"], default: undefined },
  purity: { ...safeInt, default: undefined },
  weightMgPerUnit: { ...safeInt, default: undefined },
  fineMg: { ...safeInt, default: undefined },
  laborType: { type: String, default: undefined },
  laborValue: { type: String, default: undefined }, // exact decimal text
  price: { type: priceSnapshotSchema, default: undefined },
  unitPriceMinor: { ...safeInt, required: true, min: 0 },
  metalValueMinor: { ...safeInt, default: undefined },
  laborMinor: { ...safeInt, default: undefined },
  grossMinor: { ...safeInt, required: true, min: 0 },
  lineDiscountMinor: { ...safeInt, default: 0, min: 0 },
  saleDiscountMinor: { ...safeInt, default: 0, min: 0 },
  totalMinor: { ...safeInt, required: true, min: 0 },
  // KDV breakdown of the line at sale time (absent when VAT was disabled).
  vat: {
    type: new mongoose.Schema({
      vatClass: { type: String, enum: ["exempt", "gold_margin", "full"], required: true },
      rateBp: { ...safeInt, required: true, min: 0 },
      basis: { type: String, required: true },
      taxableGrossMinor: { ...safeInt, required: true, min: 0 },
      vatMinor: { ...safeInt, required: true, min: 0 },
    }, { _id: false }),
    default: undefined,
  },
  // Cost of goods sold (null = cost unknown; profit is then not computed).
  costMinor: { type: Number, default: null, validate: (v) => v === null || Number.isSafeInteger(v) },
  returnedQuantity: { ...safeInt, default: 0, min: 0 },
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  kind: { type: String, enum: ["payment", "refund"], default: "payment" },
  method: { type: String, enum: ["nakit", "kredi kartı", "havale", "cari"], required: true },
  amountMinor: { ...safeInt, required: true, min: 1 },
  source: { type: String, enum: ["sale", "sale_collection", "account_collection", "return"], default: "sale" },
  at: { type: Date, default: Date.now },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { _id: false });

const returnSchema = new mongoose.Schema({
  returnId: { type: Number, required: true },
  lines: [{
    _id: false,
    lineId: { type: Number, required: true },
    quantity: { ...safeInt, required: true, min: 1 },
    amountMinor: { ...safeInt, required: true, min: 0 },
    costMinor: { type: Number, default: null },
    vatMinor: { ...safeInt, default: undefined },
  }],
  amountMinor: { ...safeInt, required: true, min: 0 },
  refundMinor: { ...safeInt, default: 0, min: 0 },
  refundMethod: { type: String, enum: ["nakit", "kredi kartı", "havale", "cari"], required: true },
  reason: { type: String, trim: true, maxlength: 300 },
  at: { type: Date, default: Date.now },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { _id: false });

const saleSchema = new mongoose.Schema(
  {
    _id: { type: Number, required: true },
    businessId: { type: String, required: true, trim: true, index: true, immutable: true },
    branch: { type: String, trim: true, default: "" },
    customerId: { type: Number, ref: "Customer", required: true },
    productId: { type: Number, ref: "Product", required: true },
    quantity: { type: Number, default: 1, min: 1, validate: Number.isSafeInteger },
    totalPrice: { type: Number, required: true, min: 0, validate: finiteNonNegative },
    unitPriceAtSale: { type: Number, min: 0, validate: (value) => value === null || value === undefined || finiteNonNegative(value) },
    // Null means the cost was not captured; historical profit must not be guessed.
    unitCostAtSale: { type: Number, min: 0, default: null, validate: (value) => value === null || finiteNonNegative(value) },
    status: { type: String, enum: ["completed", "cancelled", "partially_returned", "returned"], default: "completed", index: true },
    cancelledAt: { type: Date, default: null },
    paymentMethod: {
      type: String,
      enum: ["nakit", "kredi kartı", "havale", "cari"],
      default: "nakit",
    },
    date: { type: Date, required: true, default: Date.now, index: true },

    // ---- financial core (absent on legacy sales) ----
    lines: { type: [saleLineSchema], default: undefined },
    subtotalMinor: { ...safeInt, default: undefined },
    discountMinor: { ...safeInt, default: undefined },
    totalMinor: { ...safeInt, default: undefined },
    returnedMinor: { ...safeInt, default: 0 },
    paidMinor: { ...safeInt, default: undefined },
    balanceDueMinor: { ...safeInt, default: undefined },
    paymentStatus: { type: String, enum: ["paid", "partial", "unpaid", "refunded"], default: undefined },
    // Total KDV contained in totalMinor (undefined = VAT not enabled at sale time).
    vatMinor: { ...safeInt, default: undefined },
    // MASAK: identity snapshot when the sale reached the identification threshold.
    identification: {
      type: new mongoose.Schema({
        thresholdMinor: { ...safeInt, required: true },
        identityType: { type: String, required: true },
        identityNumber: { type: String, required: true, select: false },
        customerName: { type: String, required: true },
      }, { _id: false }),
      default: undefined,
    },
    payments: { type: [paymentSchema], default: undefined },
    returns: { type: [returnSchema], default: undefined },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry", default: undefined },
    cancelJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry", default: undefined },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: undefined },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true, _id: false }
);

saleSchema.index({ date: -1, status: 1 });
saleSchema.index({ productId: 1, date: -1 });
saleSchema.index({ businessId: 1, date: -1 });
saleSchema.index({ businessId: 1, customerId: 1, date: 1 });

function generate8DigitId() {
  return Math.floor(10000000 + Math.random() * 90000000);
}

saleSchema.pre("validate", async function () {
  if (!this.isNew || this._id != null) return;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = generate8DigitId();
    const exists = await mongoose.models.Sale.exists({ _id: candidate }).setOptions({ skipTenantGuard: 'global-id-probe' });
    if (!exists) {
      this._id = candidate;
      return;
    }
  }
  throw new Error("Could not allocate a unique sale ID after 10 attempts");
});

saleSchema.plugin(tenantGuard);

module.exports = mongoose.model("Sale", saleSchema);
