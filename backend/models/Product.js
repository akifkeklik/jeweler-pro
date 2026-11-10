const mongoose = require("mongoose");
const tenantGuard = require("./plugins/tenantGuard");
const { VAT_CLASSES } = require("../domain/vat");

const finiteNonNegative = (value) => Number.isFinite(value) && value >= 0;
const optionalSafeInt = (value) => value === null || value === undefined || Number.isSafeInteger(value);

/**
 * Catalogue item. Two pricing modes:
 *   fixed — `price` is the unit sale price (TRY).
 *   gram  — the unit price is computed at sale time from the live has-gold
 *           (or silver) price: weight × purity × price (+ labor). `price` is
 *           then only an indicative list price.
 *
 * Stock (`stock`) and the inventory cost pool (`costPoolMinor`, kuruş, total
 * cost of the units on hand) are projections of StockMovement documents and
 * change only through the inventory service. `costPrice` is the displayed
 * average unit cost (costPoolMinor / stock); null = cost unknown.
 */
const productSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  // Empty = available to every branch of the business (legacy behaviour).
  branch: { type: String, trim: true, default: "", maxlength: 120 },
  name: { type: String, required: true, trim: true },
  weight: { type: Number, min: 0, validate: finiteNonNegative },
  unit: String,
  price: { type: Number, min: 0, validate: finiteNonNegative },
  costPrice: { type: Number, min: 0, default: null, validate: (value) => value === null || finiteNonNegative(value) },
  costPoolMinor: { type: Number, min: 0, default: null, validate: optionalSafeInt },
  currency: { type: String, default: "TRY" },
  barcode: { type: String, trim: true, set: (value) => value === "" ? undefined : value },
  isArchived: { type: Boolean, default: false, index: true },
  description: String,
  categoryId: { type: Number, ref: "Category" },
  materialId: { type: Number, ref: "Material" },
  stock: { type: Number, default: 0, min: 0, validate: (value) => Number.isSafeInteger(value) && value >= 0 },
  // Units reserved by approved inter-branch transfers (never more than stock).
  // Sales, adjustments and returns can only take stock − reservedStock.
  reservedStock: { type: Number, default: 0, min: 0, validate: (value) => Number.isSafeInteger(value) && value >= 0 },
  // Branch copies created by transfers share the id of the original product,
  // so a transfer back lands in the same catalogue item.
  transferOriginId: { type: Number, default: null, validate: optionalSafeInt },
  pricingMode: { type: String, enum: ["fixed", "gram"], default: "fixed" },
  metal: { type: String, enum: ["XAU", "XAG", null], default: null },
  // Purity in parts per 10 000 (9160 = 22 ayar).
  purity: { type: Number, min: 1, max: 10000, default: null, validate: optionalSafeInt },
  laborType: { type: String, enum: ["none", "per_gram", "fixed", "milyem"], default: "none" },
  // KDV class (domain/vat.js). "auto" derives it from metal, purity and labour.
  vatClass: { type: String, enum: VAT_CLASSES, default: "auto" },
  // per_gram / fixed: TRY (2 decimals); milyem: ‰ (1 decimal)
  laborValue: { type: Number, min: 0, default: 0, validate: finiteNonNegative },
}, { timestamps: true, _id: false });

// Barcodes are unique per business (two shops may stock the same EAN).
productSchema.index({ businessId: 1, transferOriginId: 1, branch: 1 });

productSchema.index(
  { businessId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: "string" } } },
);

function generate6DigitId() {
  return Math.floor(100000 + Math.random() * 900000);
}

productSchema.pre("validate", async function () {
  if (!this.isNew || this._id != null) return;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = generate6DigitId();
    const exists = await mongoose.models.Product.exists({ _id: candidate }).setOptions({ skipTenantGuard: 'global-id-probe' });
    if (!exists) {
      this._id = candidate;
      return;
    }
  }
  throw new Error("Could not allocate a unique product ID after 10 attempts");
});

productSchema.plugin(tenantGuard);

module.exports = mongoose.model("Product", productSchema);
